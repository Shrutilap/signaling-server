import { CallSession } from '../models/types';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

export class ClientManager {
    private clients: Map<string, any> = new Map();
    private callSessions: Map<string, CallSession> = new Map();
    // Mobile user registry for FCM tokens
    private mobileUsers: Map<string, { socketId: string; displayName: string; fcmToken?: string; socket: any }> = new Map();
    // Web user registry
    private webUsers: Map<string, { socketId: string; displayName: string; socket: any }> = new Map();
    // Persistent user directory - keeps users even when offline
    private userDirectory: Map<string, { displayName: string; fcmToken?: string; isOnline: boolean }> = new Map();

    addClient(userId: string, socket: any): void {
        this.clients.set(userId, socket);
        logger.info({ userId }, 'Client connected');
    }

    // Mobile user management
    addMobileUser(userId: string, displayName: string, socket: any, fcmToken?: string): void {
        this.mobileUsers.set(userId, {
            socketId: socket.id || userId,
            displayName,
            fcmToken,
            socket
        });
        // Also add to persistent directory and mark as online
        this.userDirectory.set(userId, {
            displayName,
            fcmToken,
            isOnline: true
        });
        logger.info({ userId, displayName, hasFcmToken: !!fcmToken }, 'Mobile user registered');
    }

    addWebUser(userId: string, displayName: string, socket: any): void {
        this.webUsers.set(userId, {
            socketId: socket.id || userId,
            displayName,
            socket
        });
        logger.info({
            userId,
            displayName,
            socketId: socket.id,
            totalWebUsers: this.webUsers.size
        }, 'Web user registered - Socket stored');
    }

    getMobileUser(userId: string) {
        return this.mobileUsers.get(userId);
    }

    getWebUser(userId: string) {
        return this.webUsers.get(userId);
    }

    removeMobileUser(userId: string): void {
        this.mobileUsers.delete(userId);
        // Mark as offline in directory but keep the record
        const user = this.userDirectory.get(userId);
        if (user) {
            user.isOnline = false;
        }
        logger.info({ userId }, 'Mobile user disconnected');
    }

    removeWebUser(userId: string): void {
        this.webUsers.delete(userId);
        logger.info({ userId }, 'Web user disconnected');
    }

    getAllMobileUsers(): Array<{ id: string; name: string }> {
        return Array.from(this.mobileUsers.entries()).map(([userId, user]) => ({
            id: userId,
            name: user.displayName
        }));
    }

    // Get all users including offline ones
    getAllUsers(): Array<{ id: string; name: string; isOnline: boolean }> {
        return Array.from(this.userDirectory.entries()).map(([userId, user]) => ({
            id: userId,
            name: user.displayName,
            isOnline: user.isOnline
        }));
    }

    // Get user from directory (works for both online and offline)
    getUserFromDirectory(userId: string) {
        const dirUser = this.userDirectory.get(userId);
        if (!dirUser) return null;

        const mobileUser = this.mobileUsers.get(userId);
        return {
            displayName: dirUser.displayName,
            fcmToken: dirUser.fcmToken,
            isOnline: dirUser.isOnline,
            socket: mobileUser?.socket || null
        };
    }

    removeClient(userId: string): void {
        this.clients.delete(userId);
        logger.info({ userId }, 'Client disconnected');
    }

    getClient(userId: string): any | undefined {
        return this.clients.get(userId);
    }

    createCallSession(session: CallSession): void {
        this.callSessions.set(session.id, session);
        logger.info({ callId: session.id }, 'Call session created');
    }

    getCallSession(callId: string): CallSession | undefined {
        return this.callSessions.get(callId);
    }

    updateCallSession(callId: string, updates: Partial<CallSession>): void {
        const session = this.callSessions.get(callId);
        if (session) {
            Object.assign(session, updates);
            this.callSessions.set(callId, session);
        }
    }

    endCallSession(callId: string): void {
        const session = this.callSessions.get(callId);
        if (session) {
            session.status = 'ended';
            session.endedAt = Date.now();
            this.callSessions.set(callId, session);
            logger.info({ callId }, 'Call session ended');
        }
    }

    getAllSessions(): CallSession[] {
        return Array.from(this.callSessions.values());
    }

    getAllClients(): string[] {
        return Array.from(this.clients.keys());
    }
}

export const clientManager = new ClientManager();
