import { MongoClient, Db } from 'mongodb';

interface UserPermissions {
    calls: boolean;
    messages: boolean;
}

class PermissionService {
    private cache = new Map<string, { permissions: UserPermissions; expires: number }>();
    private db: Db | null = null;

    async init(mongoUrl: string, dbName: string = 'talker') {
        try {
            const client = new MongoClient(mongoUrl);
            await client.connect();
            this.db = client.db(dbName); // Use specific database name
            console.log(`[PermissionService] Connected to MongoDB database: ${dbName}`);
        } catch (error) {
            console.error('[PermissionService] MongoDB connection failed:', error);
            throw error;
        }
    }

    async getUserPermissions(empid: string): Promise<UserPermissions> {
        // Check cache first (5 min TTL)
        const cached = this.cache.get(empid);
        if (cached && Date.now() < cached.expires) {
            console.log(`[PermissionService] Cache hit for empid: ${empid}`);
            return cached.permissions;
        }

        if (!this.db) {
            throw new Error('PermissionService not initialized');
        }

        // Query MongoDB using empid
        const user = await this.db.collection('users').findOne({ empid });

        const permissions: UserPermissions = {
            calls: user?.permissions?.calls ?? true,  // Default to true if not set
            messages: user?.permissions?.messages ?? true,
        };

        console.log(`[PermissionService] Fetched permissions for empid ${empid}:`, permissions);

        // Cache for 5 minutes
        this.cache.set(empid, {
            permissions,
            expires: Date.now() + 5 * 60 * 1000,
        });

        return permissions;
    }

    // Clear cache for a specific user (useful when permissions are updated)
    clearCache(empid: string) {
        this.cache.delete(empid);
        console.log(`[PermissionService] Cleared cache for empid: ${empid}`);
    }

    // Clear entire cache
    clearAllCache() {
        this.cache.clear();
        console.log('[PermissionService] Cleared all cache');
    }
}

export default new PermissionService();
