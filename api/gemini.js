// api/gemini.js — Vercel Serverless Proxy with Zhipu (GLM-4V) Failover
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;

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

    console.warn("Gemini failed/rate-limited. Rerouting to Zhipu... Error:", geminiData.error?.message || "No text");
  } catch (err) {
    console.warn("Gemini request crashed. Rerouting to Zhipu... Error:", err.message);
  }

  // ==========================================
  // ATTEMPT 2: ZHIPU AI (GLM-4V) FAILOVER
  // ==========================================
  if (!ZHIPU_API_KEY) {
    return res.status(500).json({ error: "Gemini failed, and no ZHIPU_API_KEY was found for failover." });
  }

  try {
    // Reformat the payload for Zhipu's API structure
    const zhipuContent = [{ type: "text", text: prompt }];
    
    if (base64Image && mimeType) {
        zhipuContent.push({
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Image}` }
        });
    }

    const zhipuPayload = {
      model: "glm-4v-plus", 
      messages: [{ role: "user", content: zhipuContent }]
    };

    const zhipuResp = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ZHIPU_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(zhipuPayload)
    });

    const zhipuData = await zhipuResp.json();

    if (!zhipuResp.ok) {
       throw new Error(zhipuData.error?.message || 'Zhipu API Error');
    }

    // Extract text from Zhipu's response and return it to the app exactly as Gemini would
    const aiText = zhipuData.choices?.[0]?.message?.content || '';
    return res.status(200).json({ result: aiText });

  } catch (fallbackErr) {
    console.error("Zhipu Fallback error:", fallbackErr);
    return res.status(500).json({ error: 'Both Gemini and Zhipu AI failed. Please try again later.' });
  }
}