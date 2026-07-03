import { CallSession, WebSocketMessage } from '../models/types';
import pino from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logLevel });

const MESSAGE_BUFFER_TIMEOUT_MS = 60 * 1000; // 60 seconds

export class ClientManager {
    // private clients: Map<string, any> = new Map(); // Deprecated: Relying on mobileUsers/webUsers for active sockets
    private callSessions: Map<string, CallSession> = new Map();
    private mobileUsers: Map<string, { socketId: string; displayName: string; fcmToken?: string; socket: any }> = new Map();
    private webUsers: Map<string, { socketId: string; displayName: string; socket: any }> = new Map();
    // Persistent user directory - keeps users even when offline
    private userDirectory: Map<string, { displayName: string; fcmToken?: string; isOnline: boolean }> = new Map();
    private disconnectedClientBuffers: Map<string, { messages: WebSocketMessage[], disconnectTime: number }> = new Map();

    constructor() {
        // Periodically clean up old buffered messages
        setInterval(() => {
            const now = Date.now();
            for (const [userId, bufferEntry] of this.disconnectedClientBuffers.entries()) {
                if (now - bufferEntry.disconnectTime > MESSAGE_BUFFER_TIMEOUT_MS) {
                    logger.info({ userId }, 'Clearing expired message buffer for disconnected client');
                    this.disconnectedClientBuffers.delete(userId);
                }
            }
        }, MESSAGE_BUFFER_TIMEOUT_MS / 2); // Check every 30 seconds
    }

    /**
     * Sends a message to a client, buffering it if the client is currently disconnected.
     * @param userId The ID of the user to send the message to.
     * @param message The WebSocket message to send.
     * @returns True if the message was sent or buffered, false if the client is unknown.
     */
    sendToClient(userId: string, message: WebSocketMessage): boolean {
        const mobileUser = this.mobileUsers.get(userId);
        const webUser = this.webUsers.get(userId);

        // Prioritize mobile socket if available, otherwise web socket
        const activeSocket = mobileUser?.socket || webUser?.socket;

        if (activeSocket) {
            activeSocket.send(JSON.stringify(message));
            logger.debug({ userId, messageType: message.type }, 'Sent message to connected client');
            return true;
        } else {
            // Client is disconnected, check if they are a known user and buffer the message
            if (this.userDirectory.has(userId)) {
                let bufferEntry = this.disconnectedClientBuffers.get(userId);
                if (!bufferEntry) {
                    bufferEntry = { messages: [], disconnectTime: Date.now() };
                    this.disconnectedClientBuffers.set(userId, bufferEntry);
                }
                bufferEntry.messages.push(message);
                logger.debug({ userId, messageType: message.type, bufferSize: bufferEntry.messages.length }, 'Buffered message for disconnected client');
                return true; // Consider it 'sent' for the purpose of the API, as it's buffered
            } else {
                logger.warn({ userId, messageType: message.type }, 'Could not send message: Client not found (neither connected nor in directory)');
                return false;
            }
        }
    }

    private deliverBufferedMessages(userId: string, socket: any): void {
        const bufferEntry = this.disconnectedClientBuffers.get(userId);
        if (bufferEntry) {
            logger.info({ userId, messageCount: bufferEntry.messages.length }, 'Delivering buffered messages to reconnecting client');
            for (const message of bufferEntry.messages) {
                socket.send(JSON.stringify(message));
            }
            this.disconnectedClientBuffers.delete(userId); // Clear buffer after successful delivery
            logger.info({ userId }, 'Buffered messages delivered and buffer cleared');
        }
    }

    // Deprecated: addClient is no longer necessary as specific addMobileUser/addWebUser are used
    // If it was used externally, it needs to be updated to use mobile/web variants or removed.
    // Based on signalingServer.ts, addWebUser and addMobileUser are called directly.
    // This method is now effectively a no-op or should be removed from external calls.
    addClient(userId: string, socket: any): void {
        logger.warn({ userId }, 'Deprecated addClient method called. Use addMobileUser or addWebUser instead.');
        // For compatibility, if this is still called and a user isn\'t already registered
        // treat it as a generic web user registration for now.
        if (!this.mobileUsers.has(userId) && !this.webUsers.has(userId)) {
            this.addWebUser(userId, `GenericUser-${userId}`, socket);
        } else {
            // If user already exists, deliver buffered messages if any
            this.deliverBufferedMessages(userId, socket);
        }
    }

    // Mobile user management
    addMobileUser(userId: string, displayName: string, socket: any, fcmToken?: string): void {
        this.mobileUsers.set(userId, {
            socketId: socket.id || userId,
            displayName,
            fcmToken,
            socket
        });
        // Update persistent directory and mark as online
        const dirUser = this.userDirectory.get(userId);
        if (dirUser) {
            dirUser.isOnline = true;
            dirUser.fcmToken = fcmToken || dirUser.fcmToken; // Update FCM token if provided
            dirUser.displayName = displayName; // Update displayName
        } else {
            this.userDirectory.set(userId, {
                displayName,
                fcmToken,
                isOnline: true
            });
        }
        logger.info({ userId, displayName, hasFcmToken: !!fcmToken }, 'Mobile user registered/reconnected');
        this.deliverBufferedMessages(userId, socket); // Deliver buffered messages upon re-registration
    }

    addWebUser(userId: string, displayName: string, socket: any): void {
        this.webUsers.set(userId, {
            socketId: socket.id || userId,
            displayName,
            socket
        });
        // Update persistent directory and mark as online
        const dirUser = this.userDirectory.get(userId);
        if (dirUser) {
            dirUser.isOnline = true;
            dirUser.displayName = displayName; // Update displayName
        } else {
            this.userDirectory.set(userId, {
                displayName,
                isOnline: true // Web users typically don\'t have FCM tokens
            });
        }
        logger.info({
            userId,
            displayName,
            socketId: socket.id,
            totalWebUsers: this.webUsers.size
        }, 'Web user registered/reconnected - Socket stored');
        this.deliverBufferedMessages(userId, socket); // Deliver buffered messages upon re-registration
    }

    getMobileUser(userId: string) {
        return this.mobileUsers.get(userId);
    }

    getWebUser(userId: string) {
        return this.webUsers.get(userId);
    }

    removeMobileUser(userId: string): void {
        // Mark as offline in directory but keep the record
        const user = this.userDirectory.get(userId);
        if (user) {
            user.isOnline = false;
        }
        this.mobileUsers.delete(userId);
        // Start/update buffering for this user if they were known
        if (user) {
            let bufferEntry = this.disconnectedClientBuffers.get(userId);
            if (!bufferEntry) {
                this.disconnectedClientBuffers.set(userId, { messages: [], disconnectTime: Date.now() });
            } else {
                bufferEntry.disconnectTime = Date.now();
            }
        }
        logger.info({ userId }, 'Mobile user disconnected');
    }

    removeWebUser(userId: string): void {
        const user = this.userDirectory.get(userId);
        if (user) {
            user.isOnline = false; // Mark web user as offline in directory
        }
        this.webUsers.delete(userId);
        // Start/update buffering for this user if they were known
        if (user) {
            let bufferEntry = this.disconnectedClientBuffers.get(userId);
            if (!bufferEntry) {
                this.disconnectedClientBuffers.set(userId, { messages: [], disconnectTime: Date.now() });
            } else {
                bufferEntry.disconnectTime = Date.now();
            }
        }
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
        const webUser = this.webUsers.get(userId);

        // Return the active socket if available
        const activeSocket = mobileUser?.socket || webUser?.socket;

        return {
            displayName: dirUser.displayName,
            fcmToken: dirUser.fcmToken,
            isOnline: dirUser.isOnline,
            socket: activeSocket || null // Return active socket or null
        };
    }

    /**
     * Generic client removal when a socket disconnects.
     * This will remove the socket reference and mark the user offline in the directory.
     * Messages for this user will then be buffered by sendToClient if needed.
     * @param userId The ID of the user who disconnected.
     */
    removeClient(userId: string): void {
        // Mark user as offline in directory
        const userInDir = this.userDirectory.get(userId);
        if (userInDir) {
            userInDir.isOnline = false;
        }

        // Remove the active socket reference from mobileUsers or webUsers
        if (this.mobileUsers.has(userId)) {
            this.mobileUsers.delete(userId);
        }
        if (this.webUsers.has(userId)) {
            this.webUsers.delete(userId);
        }

        // Start buffering for this user if they were known, or update disconnectTime for existing buffer
        if (userInDir) { // Only manage buffer if the user was actually in the directory
            let bufferEntry = this.disconnectedClientBuffers.get(userId);
            if (!bufferEntry) {
                this.disconnectedClientBuffers.set(userId, { messages: [], disconnectTime: Date.now() });
            } else {
                bufferEntry.disconnectTime = Date.now();
            }
        }
        logger.info({ userId }, 'Client disconnected (generic handler)');
    }

    /**
     * Gets the active socket for a given user ID.
     * Returns undefined if the user is not currently connected via a live socket.
     * @param userId The ID of the user.
     * @returns The active socket or undefined.
     */
    getClient(userId: string): any | undefined {
        const mobileUser = this.mobileUsers.get(userId);
        if (mobileUser?.socket) {
            return mobileUser.socket;
        }
        const webUser = this.webUsers.get(userId);
        if (webUser?.socket) {
            return webUser.socket;
        }
        return undefined;
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
        // Returns all user IDs that are currently considered "clients" (either mobile or web connected)
        const connectedClients = new Set<string>();
        this.mobileUsers.forEach((_, userId) => connectedClients.add(userId));
        this.webUsers.forEach((_, userId) => connectedClients.add(userId));
        return Array.from(connectedClients.keys());
    }
}

export const clientManager = new ClientManager();
