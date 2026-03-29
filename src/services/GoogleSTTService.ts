import { v1 } from '@google-cloud/speech';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export class GoogleSTTService {
    private client: v1.SpeechClient;

    constructor() {
        this.client = new v1.SpeechClient();
        logger.info('[GoogleSTT] Initialized Google Cloud Speech Client');
    }

    /**
     * Creates a streaming recognize session.
     * @param onTranscript Callback when a final/interim transcript is received
     * @param onError Callback when an error occurs
     */
    createStream(
        onTranscript: (transcript: string, isFinal: boolean) => void,
        onError: (error: Error) => void
    ) {
        const recognizeStream = this.client
            .streamingRecognize({
                config: {
                    encoding: 'LINEAR16',
                    sampleRateHertz: 16000,
                    languageCode: 'en-US',
                },
                interimResults: true, // we want interim results so we know it's working
            })
            .on('error', (err: any) => {
                logger.error({ error: err }, '[GoogleSTT] Stream Error');
                onError(err);
            })
            .on('data', (data: any) => {
                const result = data.results[0];
                if (result && result.alternatives[0]) {
                    const transcript = result.alternatives[0].transcript;
                    const isFinal = result.isFinal;
                    
                    if (isFinal) {
                        logger.info({ transcript }, '[GoogleSTT] Final transcript');
                    }
                    
                    onTranscript(transcript, isFinal);
                }
            });

        return {
            /**
             * Writes a base64 encoded audio chunk to the stream
             */
            writeBlock: (base64Data: string) => {
                try {
                    const audioBuffer = Buffer.from(base64Data, 'base64');
                    recognizeStream.write(audioBuffer);
                } catch (e: any) {
                    logger.error({ error: e.message }, '[GoogleSTT] Error writing block to stream');
                }
            },
            
            /**
             * Closes the stream gracefully
             */
            close: () => {
                logger.info('[GoogleSTT] Closing stream');
                recognizeStream.end();
            }
        };
    }
}

export default new GoogleSTTService();
