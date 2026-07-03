import jwt from 'jsonwebtoken';
import { config, getJwtTokenTtl } from '../config';

class AuthService {
    public generateToken(userId: string, ttl?: number): string {
        const expiresIn = ttl || getJwtTokenTtl();
        return jwt.sign({ userId }, config.jwtSecret, { expiresIn });
    }

    // Placeholder for a verifyToken method if needed in the future
    public verifyToken(token: string): any {
        try {
            return jwt.verify(token, config.jwtSecret);
        } catch (error) {
            throw new Error('Invalid token');
        }
    }
}

export const authService = new AuthService();
