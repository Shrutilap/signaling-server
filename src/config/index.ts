import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: parseInt(process.env.PORT || '3000'),
    aiServerUrl: process.env.AI_SERVER_URL || 'http://localhost:8000',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    logLevel: process.env.LOG_LEVEL || 'info',
    mongodbUrl: process.env.MONGODB_URL || 'mongodb://localhost:27017/call_gateway',
    agentServerUrl: process.env.AGENT_SERVER_URL || '',
};