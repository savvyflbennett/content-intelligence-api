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
  .register('eip155:84532', new ExactEvmScheme());  // Base Sepolia - what facilitator supports

const paymentConfig = {
  'POST /analyze-ideas': {
    accepts: [{
      scheme: 'exact',
      price: '$1.00',
      network: 'eip155:84532',  // Base Sepolia
      payTo: payTo,
    }],
    description: 'Analyze raw text and extract structured ideas, themes, and insights',
    mimeType: 'application/json',
    extensions: {
      'bazaar': {  // ✅ Fixed format with info and schema
        info: {
          name: 'Content Intelligence API',
          description: 'Extracts business ideas, themes, sentiment, and insights from text discussions. Perfect for analyzing social media comments, forum posts, and brainstorming sessions.',
          tags: ['business-analysis', 'idea-extraction', 'sentiment-analysis', 'ai-insights', 'content-intelligence'],
          category: 'Data & Social APIs',
          contact: {
            email: 'savvyflbennett@gmail.com'
          }
        },
        schema: {
          input: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Raw text to analyze (min 10 characters)' },
              context: { type: 'string', description: 'Context about the text source (e.g., "TikTok comments")' }
            },
            required: ['text']
          },
          output: {
            type: 'object',
            properties: {
              top_ideas: { type: 'array', description: 'Ranked business ideas with profit potential and feasibility scores' },
              themes: { type: 'array', description: 'Key themes found in the text' },
              sentiment: { type: 'string', enum: ['optimistic', 'neutral', 'pessimistic', 'mixed'] },
              hidden_gems: { type: 'array', description: 'Overlooked high-value insights' },
              red_flags: { type: 'array', description: 'Warnings and risky advice detected' },
              executive_summary: { type: 'string', description: '2-3 sentence overview' }
            }
          }
        }
      }
    }
  }
};

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(paymentMiddleware(paymentConfig, server));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get('/openapi.json', (req, res) => {
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'Content Intelligence API',
      version: '1.0.0',
      description: 'AI-powered business idea extraction from text discussions, social media comments, and brainstorming sessions.',
      'x-guidance': 'Use POST /analyze-ideas to extract business ideas, themes, sentiment, hidden gems, and red flags from any text. Send a JSON body with "text" (required, min 10 chars) and optional "context" fields.',
      contact: {
        email: 'savvyflbennett@gmail.com'
      }
    },
    paths: {
      '/analyze-ideas': {
        post: {
          operationId: 'analyzeIdeas',
          summary: 'Analyze Ideas - Extract business insights from text',
          tags: ['Analysis'],
          'x-payment-info': {
            price: { mode: 'fixed', currency: 'USD', amount: '1.00' },
            protocols: [{ 'x402': {} }]
          },
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string', minLength: 10, description: 'Raw text to analyze (minimum 10 characters)' },
                    context: { type: 'string', description: 'Context about the text source (e.g., "TikTok comments", "Reddit thread")' }
                  },
                  required: ['text']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Successful analysis',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      analysis: {
                        type: 'object',
                        properties: {
                          top_ideas: { type: 'array', description: 'Ranked business ideas' },
                          themes: { type: 'array', description: 'Key themes' },
                          sentiment: { type: 'string' },
                          hidden_gems: { type: 'array', description: 'Overlooked insights' },
                          red_flags: { type: 'array', description: 'Warnings' },
                          executive_summary: { type: 'string' }
                        }
                      },
                      meta: { type: 'object' }
                    }
                  }
                }
              }
            },
            '402': { description: 'Payment Required - $1.00 USDC on Base Sepolia' }
          }
        }
      }
    }
  });
});

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
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

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

app.get('/.well-known/x402', (req, res) => {
  res.json({
    name: 'Content Intelligence API',
    description: 'AI-powered business idea extraction from text discussions, social media comments, and brainstorming sessions.',
    version: '1.0.0',
    endpoints: [
      {
        path: '/analyze-ideas',
        method: 'POST',
        price: '$1.00',
        currency: 'USDC',
        network: 'eip155:84532',
        description: 'Analyze text and extract structured business insights including ideas, themes, sentiment, hidden gems, and red flags'
      }
    ],
    contact: {
      email: 'savvyflbennett@gmail.com',
      url: 'https://github.com/savvyflbennett/content-intelligence-api'
    }
  });
});

app.listen(process.env.PORT || 10000, () => {
  console.log(`🚀 Content Intelligence API live on port ${process.env.PORT || 10000}`);
  console.log(`💰 Charging $1.00 per /analyze-ideas call`);
  console.log(`📥 Test with: curl -X POST http://localhost:10000/analyze-ideas -H "Content-Type: application/json" -d '{"text":"your text here"}'`);
});