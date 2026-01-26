import { Db, ObjectId } from 'mongodb';

interface Message {
    senderId: string;
    text: string;
    createdAt: Date;
}

interface Conversation {
    _id?: ObjectId;
    conversationId: string;
    createdAt: Date;
    lastMessageAt: Date;
    messages: Message[];
    participants: string[];
}

class ConversationService {
    private db: Db | null = null;

    /**
     * Initialize the service with the database connection
     */
    init(db: Db) {
        this.db = db;
        console.log('[ConversationService] Initialized with database connection');
    }

    /**
     * Generate conversation ID from two participant IDs (always sorted for consistency)
     */
    private getConversationId(userId1: string, userId2: string): string {
        return [userId1, userId2].sort().join('_');
    }

    /**
     * Log a message to the conversation
     * Creates conversation if it doesn't exist, otherwise appends message
     */
    async logMessage(
        senderId: string,
        recipientId: string,
        text: string,
        timestamp?: number
    ): Promise<void> {
        if (!this.db) {
            throw new Error('ConversationService not initialized');
        }

        try {
            const conversationId = this.getConversationId(senderId, recipientId);
            const participants = [senderId, recipientId].sort();
            const now = new Date(timestamp || Date.now());

            const message: Message = {
                senderId,
                text,
                createdAt: now,
            };

            // Upsert conversation: create if doesn't exist, update if exists
            await this.db.collection('conversations').updateOne(
                { conversationId },
                {
                    $setOnInsert: {
                        conversationId,
                        createdAt: now,
                        participants,
                    },
                    $set: {
                        lastMessageAt: now,
                    },
                    $push: {
                        messages: message,
                    } as any, // Type cast needed for MongoDB push operation
                },
                { upsert: true }
            );

            console.log(
                `[ConversationService] Message logged: ${conversationId} | ${senderId} → ${recipientId}`
            );
        } catch (error) {
            console.error('[ConversationService] Error logging message:', error);
            throw error;
        }
    }

    /**
     * Get a specific conversation by conversationId
     */
    async getConversation(conversationId: string): Promise<Conversation | null> {
        if (!this.db) {
            throw new Error('ConversationService not initialized');
        }

        try {
            const conversation = await this.db
                .collection('conversations')
                .findOne({ conversationId }) as Conversation | null;

            return conversation;
        } catch (error) {
            console.error('[ConversationService] Error fetching conversation:', error);
            throw error;
        }
    }

    /**
     * Get all conversations for a specific user
     */
    async getConversationsByUser(userId: string): Promise<Conversation[]> {
        if (!this.db) {
            throw new Error('ConversationService not initialized');
        }

        try {
            const conversations = await this.db
                .collection('conversations')
                .find({ participants: userId })
                .sort({ lastMessageAt: -1 })
                .toArray() as Conversation[];

            console.log(
                `[ConversationService] Found ${conversations.length} conversations for user ${userId}`
            );

            return conversations;
        } catch (error) {
            console.error('[ConversationService] Error fetching user conversations:', error);
            throw error;
        }
    }
}

export default new ConversationService();
