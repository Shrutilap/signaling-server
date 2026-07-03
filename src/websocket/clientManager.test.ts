import { ClientManager } from './clientManager';
import { WebSocketMessage } from '../models/types';

// Mock pino logger to prevent console output during tests
jest.mock('pino', () => jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
})));

// Mock config for log level if needed
jest.mock('../config', () => ({
    config: {
        logLevel: 'silent', // Set log level to silent for tests
    },
}));

// Helper to create a mock socket with a unique ID
let socketIdCounter = 0;
const createMockSocket = () => ({
    id: `socket-${++socketIdCounter}`,
    send: jest.fn(),
    emit: jest.fn(),
    on: jest.fn(),
    disconnect: jest.fn(),
});

describe('ClientManager', () => {
    let clientManager: ClientManager;
    let mockSocket: ReturnType<typeof createMockSocket>;
    const userId = 'testUser123';
    const displayName = 'Test User';
    const fcmToken = 'testFcmToken';

    beforeEach(() => {
        jest.clearAllMocks();
        // Use fake timers to control Date.now() and setInterval
        jest.useFakeTimers();
        clientManager = new ClientManager();
        mockSocket = createMockSocket();
    });

    afterEach(() => {
        // Restore real timers
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('should send messages directly to a connected client', () => {
        clientManager.addMobileUser(userId, displayName, mockSocket, fcmToken);

        const message: WebSocketMessage = { type: 'test-message', payload: { data: 'hello' } };
        const sent = clientManager.sendToClient(userId, message);

        expect(sent).toBe(true);
        expect(mockSocket.send).toHaveBeenCalledTimes(1);
        expect(mockSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
        // Expect no messages to be buffered for a connected client
        expect((clientManager as any).disconnectedClientBuffers.get(userId)).toBeUndefined();
    });

    it('should buffer messages for a disconnected client', () => {
        clientManager.addMobileUser(userId, displayName, mockSocket, fcmToken);
        clientManager.removeClient(userId); // Simulate disconnect
        mockSocket.send.mockClear(); // Clear send calls from any initial connection/reconnect

        const message1: WebSocketMessage = { type: 'buffered-message-1', payload: { data: 'one' } };
        const message2: WebSocketMessage = { type: 'buffered-message-2', payload: { data: 'two' } };

        const sent1 = clientManager.sendToClient(userId, message1);
        const sent2 = clientManager.sendToClient(userId, message2);

        expect(sent1).toBe(true); // sendToClient returns true if buffered
        expect(sent2).toBe(true);
        expect(mockSocket.send).not.toHaveBeenCalled(); // Original socket should not receive
        
        const buffer = (clientManager as any).disconnectedClientBuffers.get(userId);
        expect(buffer).toBeDefined();
        expect(buffer.messages).toHaveLength(2);
        expect(buffer.messages[0]).toEqual(message1);
        expect(buffer.messages[1]).toEqual(message2);
        expect(buffer.disconnectTime).toBeDefined();
    });

    it('should deliver buffered messages upon client reconnection in order', () => {
        clientManager.addMobileUser(userId, displayName, mockSocket, fcmToken);
        clientManager.removeClient(userId); // Simulate disconnect
        mockSocket.send.mockClear(); // Clear send calls from any initial connection/reconnect

        const message1: WebSocketMessage = { type: 'buffered-message-1', payload: { data: 'one' } };
        const message2: WebSocketMessage = { type: 'buffered-message-2', payload: { data: 'two' } };
        clientManager.sendToClient(userId, message1);
        clientManager.sendToClient(userId, message2);

        // Reconnect the client with a new socket
        const newMockSocket = createMockSocket();
        clientManager.addMobileUser(userId, displayName, newMockSocket, fcmToken);

        expect(newMockSocket.send).toHaveBeenCalledTimes(2);
        expect(newMockSocket.send).toHaveBeenNthCalledWith(1, JSON.stringify(message1));
        expect(newMockSocket.send).toHaveBeenNthCalledWith(2, JSON.stringify(message2));
        
        // Buffer should be cleared after delivery
        expect((clientManager as any).disconnectedClientBuffers.get(userId)).toBeUndefined();
    });

    it('should clear expired buffered messages after timeout', () => {
        clientManager.addMobileUser(userId, displayName, mockSocket, fcmToken);
        clientManager.removeClient(userId); // Simulate disconnect
        mockSocket.send.mockClear();

        const message: WebSocketMessage = { type: 'expired-message', payload: {} };
        clientManager.sendToClient(userId, message);

        const buffer = (clientManager as any).disconnectedClientBuffers.get(userId);
        expect(buffer).toBeDefined();

        // Advance timers past the buffer timeout
        jest.advanceTimersByTime(60 * 1000 + 1); // 60 seconds + 1ms

        // The setInterval callback should have run and cleared the buffer
        expect((clientManager as any).disconnectedClientBuffers.get(userId)).toBeUndefined();
    });

    it('should update disconnectTime when a client disconnects multiple times', () => {
        clientManager.addMobileUser(userId, displayName, mockSocket, fcmToken);
        clientManager.removeClient(userId);
        mockSocket.send.mockClear();
        const initialDisconnectTime = (clientManager as any).disconnectedClientBuffers.get(userId).disconnectTime;

        jest.advanceTimersByTime(10 * 1000); // 10 seconds later
        
        // Reconnect and disconnect again to update the disconnectTime
        const newMockSocket = createMockSocket();
        clientManager.addMobileUser(userId, displayName, newMockSocket, fcmToken); // This also clears buffer and marks online
        clientManager.removeClient(userId); // Disconnect again, creating a new buffer entry with new disconnectTime
        newMockSocket.send.mockClear();

        const newDisconnectTime = (clientManager as any).disconnectedClientBuffers.get(userId).disconnectTime;
        expect(newDisconnectTime).toBeGreaterThan(initialDisconnectTime);
    });

    it('should not buffer messages for unknown users (not in userDirectory)', () => {
        const unknownUserId = 'unknownUser123';
        const message: WebSocketMessage = { type: 'unknown-message', payload: {} };

        const sent = clientManager.sendToClient(unknownUserId, message);
        expect(sent).toBe(false); // Should return false as user is unknown
        expect((clientManager as any).disconnectedClientBuffers.get(unknownUserId)).toBeUndefined();
    });

    it('should handle web user buffering and delivery', () => {
        const webUserId = 'webUser456';
        const webDisplayName = 'Web User';
        const webMockSocket = createMockSocket();

        clientManager.addWebUser(webUserId, webDisplayName, webMockSocket);
        clientManager.removeClient(webUserId); // Simulate disconnect
        webMockSocket.send.mockClear();

        const message: WebSocketMessage = { type: 'web-message', payload: { data: 'web data' } };
        clientManager.sendToClient(webUserId, message);

        const buffer = (clientManager as any).disconnectedClientBuffers.get(webUserId);
        expect(buffer).toBeDefined();
        expect(buffer.messages).toHaveLength(1);

        const newWebMockSocket = createMockSocket();
        clientManager.addWebUser(webUserId, webDisplayName, newWebMockSocket);

        expect(newWebMockSocket.send).toHaveBeenCalledTimes(1);
        expect(newWebMockSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
        expect((clientManager as any).disconnectedClientBuffers.get(webUserId)).toBeUndefined();
    });

    it('should not create a buffer if removeMobileUser is called for a non-existent user in directory', () => {
        // Ensure the user is not in the directory initially
        expect(clientManager.getUserFromDirectory('nonExistentUser')).toBeNull();
        clientManager.removeMobileUser('nonExistentUser');
        expect((clientManager as any).disconnectedClientBuffers.size).toBe(0);
    });

    it('should not create a buffer if removeWebUser is called for a non-existent user in directory', () => {
        // Ensure the user is not in the directory initially
        expect(clientManager.getUserFromDirectory('anotherNonExistentUser')).toBeNull();
        clientManager.removeWebUser('anotherNonExistentUser');
        expect((clientManager as any).disconnectedClientBuffers.size).toBe(0);
    });

    it('should update isOnline status in userDirectory on disconnect', () => {
        clientManager.addMobileUser(userId, displayName, mockSocket, fcmToken);
        let user = clientManager.getUserFromDirectory(userId);
        expect(user?.isOnline).toBe(true);

        clientManager.removeClient(userId); // This marks user as offline
        user = clientManager.getUserFromDirectory(userId);
        expect(user?.isOnline).toBe(false);
    });

    it('should update isOnline status in userDirectory on reconnect', () => {
        clientManager.addMobileUser(userId, displayName, mockSocket, fcmToken);
        clientManager.removeClient(userId);
        
        let user = clientManager.getUserFromDirectory(userId);
        expect(user?.isOnline).toBe(false);

        const newMockSocket = createMockSocket();
        clientManager.addMobileUser(userId, displayName, newMockSocket, fcmToken);
        user = clientManager.getUserFromDirectory(userId);
        expect(user?.isOnline).toBe(true);
    });

    it('should handle multiple messages buffered and delivered correctly', () => {
        clientManager.addWebUser(userId, displayName, mockSocket);
        clientManager.removeClient(userId);
        mockSocket.send.mockClear();

        const messages: WebSocketMessage[] = [];
        for (let i = 0; i < 5; i++) {
            const message: WebSocketMessage = { type: `msg-${i}`, payload: { id: i } };
            clientManager.sendToClient(userId, message);
            messages.push(message);
        }

        const buffer = (clientManager as any).disconnectedClientBuffers.get(userId);
        expect(buffer.messages).toHaveLength(5);

        const newMockSocket = createMockSocket();
        clientManager.addWebUser(userId, displayName, newMockSocket);

        expect(newMockSocket.send).toHaveBeenCalledTimes(5);
        for (let i = 0; i < 5; i++) {
            expect(newMockSocket.send).toHaveBeenNthCalledWith(i + 1, JSON.stringify(messages[i]));
        }
        expect((clientManager as any).disconnectedClientBuffers.get(userId)).toBeUndefined();
    });

    it('should log a warning for deprecated addClient method and handle it correctly', () => {
        const oldUserId = 'oldClientUser';
        const oldMockSocket = createMockSocket();
        const message: WebSocketMessage = { type: 'deprecated-client-message', payload: {} };

        // Simulate a scenario where a user was known, disconnected, and then uses addClient.
        // Ensure the user exists in the directory first for buffering to be possible.
        (clientManager as any).userDirectory.set(oldUserId, { displayName: `GenericUser-${oldUserId}`, isOnline: false });
        (clientManager as any).disconnectedClientBuffers.set(oldUserId, { messages: [message], disconnectTime: Date.now() - 10000 });
        
        clientManager.addClient(oldUserId, oldMockSocket);

        expect(pino().warn).toHaveBeenCalledWith({ userId: oldUserId }, 'Deprecated addClient method called. Use addMobileUser or addWebUser instead.');
        
        // Expect buffered messages to be delivered
        expect(oldMockSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
        expect((clientManager as any).disconnectedClientBuffers.get(oldUserId)).toBeUndefined();
        
        // Verify the user is now registered as a web user
        const webUser = clientManager.getWebUser(oldUserId);
        expect(webUser).toBeDefined();
        expect(webUser?.socket).toBe(oldMockSocket);
        expect(webUser?.displayName).toBe(`GenericUser-${oldUserId}`);
        
        // Also verify userDirectory is updated
        const dirUser = clientManager.getUserFromDirectory(oldUserId);
        expect(dirUser?.isOnline).toBe(true);
    });

    it('should handle addClient when user is already registered (no new web user, just deliver buffer)', () => {
        const existingUserId = 'existingMobileUser';
        const existingDisplayName = 'Existing Mobile';
        const existingSocket = createMockSocket();

        clientManager.addMobileUser(existingUserId, existingDisplayName, existingSocket, 'someFcmToken');
        clientManager.removeClient(existingUserId);
        existingSocket.send.mockClear();

        const message1: WebSocketMessage = { type: 'buffered-existing-1', payload: {} };
        clientManager.sendToClient(existingUserId, message1);

        // Call addClient with the same user ID (but it will be a different socket from reconnect)
        const reconnectingSocket = createMockSocket();
        clientManager.addClient(existingUserId, reconnectingSocket);

        expect(pino().warn).toHaveBeenCalledWith({ userId: existingUserId }, 'Deprecated addClient method called. Use addMobileUser or addWebUser instead.');
        
        // Ensure the original mobile user entry is still there and active socket is updated due to addMobileUser called internally.
        const mobileUser = clientManager.getMobileUser(existingUserId);
        expect(mobileUser).toBeDefined();
        expect(mobileUser?.socket).toBe(reconnectingSocket);

        // Buffered messages should be delivered to the new socket
        expect(reconnectingSocket.send).toHaveBeenCalledWith(JSON.stringify(message1));
        expect((clientManager as any).disconnectedClientBuffers.get(existingUserId)).toBeUndefined();

        // Should NOT have created a new web user entry since mobile user existed.
        expect(clientManager.getWebUser(existingUserId)).toBeUndefined();
    });
});