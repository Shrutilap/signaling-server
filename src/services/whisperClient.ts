import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

const WHISPER_SERVICE_URL = 'http://localhost:5000';

export async function transcribeAudio(audioFilePath: string): Promise<{ text: string; language: string }> {
    try {
        const formData = new FormData();
        formData.append('audio', fs.createReadStream(audioFilePath));

        const response = await axios.post(`${WHISPER_SERVICE_URL}/transcribe`, formData, {
            headers: {
                ...formData.getHeaders(),
            },
        });

        if (!response.data.success) {
            throw new Error('Transcription failed');
        }

        return {
            text: response.data.text,
            language: response.data.language || 'unknown',
        };
    } catch (error: any) {
        console.error('[WhisperClient] Transcription error:', error.message);
        throw new Error(`Whisper transcription failed: ${error.message}`);
    }
}

export async function checkWhisperHealth(): Promise<boolean> {
    try {
        const response = await axios.get(`${WHISPER_SERVICE_URL}/health`);
        return response.data.status === 'healthy';
    } catch (error) {
        console.error('[WhisperClient] Health check failed');
        return false;
    }
}
