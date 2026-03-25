// api/gemini.js — Vercel Serverless Proxy
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing in Vercel.");

    const { prompt, mimeType, base64Image, isJson } = req.body;

    const generationConfig = {};
    if (isJson) generationConfig.responseMimeType = "application/json"; // MUST be camelCase

    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: { // MUST be camelCase
              mimeType: mimeType, // MUST be camelCase
              data: base64Image
            }
          }
        ]
      }],
      generationConfig
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Gemini API Error');

    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ result: aiText });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Proxy error: ' + error.message });
  }
}