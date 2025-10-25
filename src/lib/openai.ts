import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // la clé est stockée dans .env.local
  dangerouslyAllowBrowser: false,
});

export default openai;
