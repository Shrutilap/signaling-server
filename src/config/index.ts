import dotenv from 'dotenv';
dotenv.config();

if (!process.env.MONGODB_URL && !process.env.CI) {
    // Only throw in production or if not testing
    if (process.env.NODE_ENV === 'production') {
        throw new Error("MONGODB_URL is required in production");
    }
}

export const config = {
    port: parseInt(process.env.PORT || '8080', 10),
    mongodbUrl: process.env.MONGODB_URL || 'mongodb://localhost:27017/call_gateway',
   
    aiServerUrl: process.env.AI_SERVER_URL || 'http://localhost:8000',
    agentServerUrl: process.env.AGENT_SERVER_URL || '',
    logLevel: process.env.LOG_LEVEL || 'info',
};
