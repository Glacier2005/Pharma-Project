import { GoogleGenAI } from '@google/genai';

export class AiService {
  /**
   * Optionally use Gemini to parse raw OCR text into structured data.
   * If Gemini fails or is not configured, gracefully falls back to returning the raw text.
   */
  static async structurePrescriptionText(ocrText: string): Promise<any> {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn('GEMINI_API_KEY not found. Skipping AI structuring.');
        return { rawText: ocrText, medicines: [] };
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const prompt = `
      You are a medical assistant extracting medicines from raw OCR text of a prescription.
      Raw OCR Text:
      """
      ${ocrText}
      """
      Extract any recognized medicines, their strengths, dosages, and durations.
      Respond strictly in JSON format matching this schema:
      {
        "medicines": [
          {
            "name": "string",
            "strength": "string (optional)",
            "dosage": "string (optional)",
            "duration": "string (optional)"
          }
        ]
      }
      Do not include markdown blocks or any other text.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      if (response.text) {
        try {
          return JSON.parse(response.text);
        } catch (e) {
          console.error('Failed to parse Gemini response as JSON', e);
          return { rawText: ocrText, medicines: [] };
        }
      }
      return { rawText: ocrText, medicines: [] };
    } catch (error) {
      console.error('AI Structuring failed:', error);
      // Graceful degradation: If Gemini fails, we just don't have structured data
      return { rawText: ocrText, medicines: [], error: 'AI unavailable' };
    }
  }
}
