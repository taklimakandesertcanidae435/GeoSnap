import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// AI Provider: gemini (free API) or ollama (local)
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2-vision';
const USE_GEMINI = !!GEMINI_KEY;

let genAI, geminiModel;
if (USE_GEMINI) {
  genAI = new GoogleGenerativeAI(GEMINI_KEY);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

app.use(express.static(join(__dirname, 'public')));

const PROMPT = `You are an expert geolocation analyst. Analyze this photograph and determine the exact location where it was taken.

Carefully examine: street signs, text and language (Arabic, French, English, etc.), architecture style, vegetation and trees, road markings, license plates, vehicles, terrain, brands, flags, climate indicators, infrastructure.

Respond with ONLY a valid JSON object. No markdown fences, no explanation, just raw JSON:

{
  "latitude": number (precise to 4+ decimals),
  "longitude": number (precise to 4+ decimals),
  "confidence": "high" | "medium" | "low",
  "confidencePercent": number (0-100),
  "locationName": "specific place or street name",
  "city": "city name",
  "region": "state/province",
  "country": "country name",
  "countryCode": "2-letter ISO code",
  "continent": "continent",
  "analysis": {
    "clues": [
      {"type": "clue_type", "observation": "what you see", "significance": "why it matters"}
    ],
    "reasoning": "2-3 sentences explaining your deduction"
  }
}`;

// ============ GEMINI PROVIDER ============
async function analyzeWithGemini(imgBuffer, mimeType) {
  const base64 = imgBuffer.toString('base64');

  const result = await geminiModel.generateContent([
    PROMPT,
    {
      inlineData: {
        mimeType: mimeType,
        data: base64,
      },
    },
  ]);

  return result.response.text();
}

// ============ OLLAMA PROVIDER ============
async function analyzeWithOllama(imgBuffer) {
  const base64 = imgBuffer.toString('base64');

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: 'user', content: PROMPT, images: [base64] }],
      stream: false,
      options: { temperature: 0.2, num_predict: 1500 },
    });

    const url = new URL(`${OLLAMA_URL}/api/chat`);
    const reqOpts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 5 * 60 * 1000,
    };

    const httpReq = http.request(reqOpts, (httpRes) => {
      let data = '';
      httpRes.on('data', (chunk) => { data += chunk; });
      httpRes.on('end', () => {
        if (httpRes.statusCode !== 200) {
          return reject(new Error(`Ollama error (${httpRes.statusCode}): ${data.slice(0, 200)}`));
        }
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.message?.content || parsed.response || '');
        } catch {
          reject(new Error('Invalid JSON from Ollama'));
        }
      });
    });

    httpReq.on('error', reject);
    httpReq.on('timeout', () => {
      httpReq.destroy();
      reject(new Error('Request timed out (5 min)'));
    });
    httpReq.write(payload);
    httpReq.end();
  });
}

// ============ JSON REPAIR ============
function repairAndParseJSON(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON found in AI response');

  let raw = text.slice(start);

  // Strategy 1: Try trimming from the end
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i] === '}') {
      try { return JSON.parse(raw.slice(0, i + 1)); } catch { /* keep trying */ }
    }
  }

  // Strategy 2: Regex extract core fields
  console.error('JSON parse failed, extracting fields with regex...');
  const getStr = (key) => {
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*?)"`));
    return m ? m[1] : '';
  };
  const getNum = (key) => {
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*(-?[\\d.]+)`));
    return m ? parseFloat(m[1]) : 0;
  };

  return {
    latitude: getNum('latitude'),
    longitude: getNum('longitude'),
    confidence: getStr('confidence') || 'low',
    confidencePercent: getNum('confidencePercent') || 30,
    locationName: getStr('locationName') || 'Unknown',
    city: getStr('city') || '',
    region: getStr('region') || '',
    country: getStr('country') || '',
    countryCode: getStr('countryCode') || '',
    continent: getStr('continent') || '',
    analysis: { clues: [], reasoning: 'Analysis data was partially truncated.' },
  };
}

// ============ MAIN ROUTE ============
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const imgBuffer = await sharp(req.file.buffer)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    console.log(`Analyzing image (${(imgBuffer.length / 1024).toFixed(0)}KB) with ${USE_GEMINI ? 'Gemini' : 'Ollama'}...`);

    let responseText;
    if (USE_GEMINI) {
      // Retry up to 2 times on rate limit
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          responseText = await analyzeWithGemini(imgBuffer, 'image/jpeg');
          break;
        } catch (e) {
          if (e.message?.includes('429') && attempt < 2) {
            console.log(`Rate limited, retrying in ${(attempt + 1) * 15}s...`);
            await new Promise(r => setTimeout(r, (attempt + 1) * 15000));
          } else {
            throw e;
          }
        }
      }
    } else {
      responseText = await analyzeWithOllama(imgBuffer);
    }

    console.log('AI responded. Parsing...');
    console.log('Raw (first 300):', responseText.slice(0, 300));

    let result;
    try {
      // Strip markdown code fences if present
      const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      result = repairAndParseJSON(responseText);
    }

    // Ensure required fields
    result.latitude = Number(result.latitude) || 0;
    result.longitude = Number(result.longitude) || 0;
    result.confidence = result.confidence || 'low';
    result.confidencePercent = Number(result.confidencePercent) || 30;
    result.locationName = result.locationName || 'Unknown';
    result.city = result.city || '';
    result.country = result.country || '';
    result.analysis = result.analysis || { clues: [], reasoning: '' };

    res.json(result);
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Image too large. Maximum size is 10MB.' });
    }
  }
  if (err.message === 'Only image files are allowed') {
    return res.status(415).json({ error: err.message });
  }
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(port, async () => {
  console.log(`\n🌍 GeoSnap is running at http://localhost:${port}`);
  if (USE_GEMINI) {
    console.log('✅ Using Google Gemini (free API)');
  } else {
    console.log('⚠️  No GEMINI_API_KEY found — using Ollama (local, less accurate)');
    console.log('   For better results, get a FREE Gemini key at: https://aistudio.google.com/apikey');
    // Check Ollama
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`);
      const data = await res.json();
      const models = data.models?.map((m) => m.name) || [];
      console.log(`   Ollama models: ${models.join(', ')}`);
    } catch {
      console.error('   ❌ Ollama is not running!');
    }
  }
  console.log('');
});
