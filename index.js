import express from 'express';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import cors from 'cors';

dotenv.config();

const app = express();
const payTo = process.env.WALLET_ADDRESS;

const facilitator = new HTTPFacilitatorClient({
  url: 'https://x402.org/facilitator'
});

const server = new x402ResourceServer(facilitator)
  .register('eip155:84532', new ExactEvmScheme());

const paymentConfig = {
  'POST /analyze-ideas': {
    accepts: [{
      scheme: 'exact',
      price: '$1.00',
      network: 'eip155:84532',
      payTo: payTo,
    }],
    description: 'Analyze raw text and extract structured ideas, themes, and insights',
    mimeType: 'application/json',
  }
};

// ✅ Apply x402 payment middleware BEFORE express.json() and CORS
app.use(paymentMiddleware(paymentConfig, server));

// Now apply regular middleware
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/analyze-ideas', async (req, res) => {
  try {
    const { text, context = 'General discussion' } = req.body;

    if (!text || text.length < 10) {
      return res.status(400).json({ error: 'Please provide at least 10 characters of text to analyze.' });
    }

    const prompt = `You are an expert business analyst and idea extractor. Analyze the following text and extract the most valuable insights.

CONTEXT: ${context}

TEXT TO ANALYZE:
"""
${text}
"""

Return a JSON object with exactly this structure:
{
  "top_ideas": [
    {
      "idea": "Brief description of the idea",
      "profit_potential": "high|medium|low",
      "feasibility": "high|medium|low",
      "source": "Who suggested it or 'general consensus'"
    }
  ],
  "themes": ["theme1", "theme2", "theme3"],
  "sentiment": "optimistic|neutral|pessimistic|mixed",
  "hidden_gems": [
    {
      "insight": "The overlooked valuable insight",
      "why_it_matters": "Why this is valuable"
    }
  ],
  "red_flags": [
    {
      "warning": "What to watch out for",
      "reason": "Why this is risky or bad advice"
    }
  ],
  "executive_summary": "2-3 sentence overview of the entire discussion"
}

Rules:
- Extract 3-8 top ideas max
- Rank by profit potential AND feasibility
- Hidden gems are ideas with high value but low visibility
- Red flags are common misconceptions or risky advice
- Be specific, not generic
- Return ONLY the JSON, no markdown formatting`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    });

    let rawResponse = completion.choices[0].message.content;
    rawResponse = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const analysis = JSON.parse(rawResponse);

    res.json({
      success: true,
      analysis,
      meta: {
        text_length: text.length,
        context: context,
        model: 'gpt-4o-mini',
        cost_to_you: '~$0.005'
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      details: error.message 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'content-intelligence-api' });
});

app.listen(process.env.PORT || 10000, () => {
  console.log(`🚀 Content Intelligence API live on port ${process.env.PORT || 10000}`);
  console.log(`💰 Charging $1.00 per /analyze-ideas call`);
  console.log(`📥 Test with: curl -X POST http://localhost:10000/analyze-ideas -H "Content-Type: application/json" -d '{"text":"your text here"}'`);
});