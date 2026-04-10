// api/gemini.js — Vercel Serverless Proxy with Groq Failover
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY is missing." });

  const { prompt, mimeType, base64Image, isJson } = req.body;

  // ==========================================
  // ATTEMPT 1: GOOGLE GEMINI 2.5 FLASH
  // ==========================================
  try {
    const geminiConfig = {};
    if (isJson) geminiConfig.responseMimeType = "application/json";

    const geminiParts = [{ text: prompt }];
    if (base64Image && mimeType) {
        geminiParts.push({ inlineData: { mimeType: mimeType, data: base64Image } });
    }

    const geminiPayload = {
      contents: [{ role: "user", parts: geminiParts }],
      generationConfig: geminiConfig
    };

    const geminiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const geminiData = await geminiResp.json();

    // If Gemini succeeded, return immediately!
    if (geminiResp.ok && geminiData.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({ result: geminiData.candidates[0].content.parts[0].text });
    }

    console.warn("Gemini failed/rate-limited. Rerouting to Groq... Error:", geminiData.error?.message || "No text");
  } catch (err) {
    console.warn("Gemini request crashed. Rerouting to Groq... Error:", err.message);
  }

  // ==========================================
  // ATTEMPT 2: GROQ (LLAMA-3.2-VISION) FAILOVER
  // ==========================================
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "Gemini failed, and no GROQ_API_KEY was found for failover." });
  }

  try {
    // Reformat the payload for Groq's OpenAI-compatible structure
    const groqContent = [{ type: "text", text: prompt }];
    
    if (base64Image && mimeType) {
        groqContent.push({
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Image}` }
        });
    }

    const groqPayload = {
      model: "llama-3.2-90b-vision-preview", 
      messages: [{ role: "user", content: groqContent }],
      temperature: 0.1
    };

    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(groqPayload)
    });

    const groqData = await groqResp.json();

    if (!groqResp.ok) {
       throw new Error(groqData.error?.message || 'Groq API Error');
    }

    // Extract text from Groq's response and return it to the app exactly as Gemini would
    const aiText = groqData.choices?.[0]?.message?.content || '';
    return res.status(200).json({ result: aiText });

  } catch (fallbackErr) {
    console.error("Groq Fallback error:", fallbackErr);
    return res.status(500).json({ error: 'Both Gemini and Groq AI failed. Please try again later.' });
  }
}