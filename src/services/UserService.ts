import { Db } from 'mongodb';
import PermissionService from './PermissionService';

export interface DatabaseUser {
    _id: string;
    empid: string;
    name: string;
    email: string;
    gender?: string;
    role?: string;
    department?: string;
    availability?: string;
}

class UserService {
    private db: Db | null = null;

    /**
     * Initialize the service with the database connection
     * This should be called after PermissionService is initialized
     */
    init(db: Db) {
        this.db = db;
        console.log('[UserService] Initialized with database connection');
    }

    /**
     * Fetch all users from the database
     * Returns only essential fields, excludes sensitive data like passwords
     */
    async getAllUsers(): Promise<DatabaseUser[]> {
        if (!this.db) {
            throw new Error('UserService not initialized');
        }

        try {
            const users = await this.db
                .collection('users')
                .find({})
                .project({
                    _id: 1,
                    empid: 1,
                    name: 1,
                    email: 1,
                    gender: 1,
                    role: 1,
                    department: 1,
                    availability: 1,
                })
                .toArray();

            console.log(`[UserService] Fetched ${users.length} users from database`);

            return users.map(user => ({
                _id: user._id.toString(),
                empid: user.empid,
                name: user.name,
                email: user.email,
                gender: user.gender,
                role: user.role,
                department: user.department,
                availability: user.availability,
            }));
        } catch (error) {
            console.error('[UserService] Error fetching users:', error);
            throw error;
        }
    }

    /**
     * Get a specific user by empid
     */
    async getUserByEmpId(empid: string): Promise<DatabaseUser | null> {
        if (!this.db) {
            throw new Error('UserService not initialized');
        }

        try {
            const user = await this.db
                .collection('users')
                .findOne(
                    { empid },
                    {
                        projection: {
                            _id: 1,
                            empid: 1,
                            name: 1,
                            email: 1,
                            gender: 1,
                            role: 1,
                            department: 1,
                            availability: 1,
                        }
                    }
                );

            if (!user) {
                return null;
            }

            return {
                _id: user._id.toString(),
                empid: user.empid,
                name: user.name,
                email: user.email,
                gender: user.gender,
                role: user.role,
                department: user.department,
                availability: user.availability,
            };
        } catch (error) {
            console.error('[UserService] Error fetching user:', error);
            throw error;
        }
    }

    /**
     * Update user details in the database
     */
    async updateUser(empid: string, userData: Partial<DatabaseUser>): Promise<void> {
        if (!this.db) {
            throw new Error('UserService not initialized');
        }

        const { _id, ...updateData } = userData; // Remove _id if present

        await this.db.collection('users').updateOne(
            { empid },
            {
                $set: {
                    ...updateData,
                    updatedAt: new Date()
                }
            }
        );

        console.log(`[UserService] Updated profile for ${empid}`);
    }

    /**
     * Update user availability status
     */
    async updateAvailability(empid: string, availability: string): Promise<void> {
        if (!this.db) {
            throw new Error('UserService not initialized');
        }

        await this.db.collection('users').updateOne(
            { empid },
            {
                $set: {
                    availability,
                    updatedAt: new Date()
                }
            }
        );

        console.log(`[UserService] Updated availability for ${empid}: ${availability}`);
    }
}

export default new UserService();
