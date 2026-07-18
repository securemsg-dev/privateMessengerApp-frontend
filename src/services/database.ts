import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

// Initialize the database asynchronously
export const initDB = async () => {
  try {
    db = await SQLite.openDatabaseAsync('zangi_local.db');

    // Create Contacts Table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        avatar_url TEXT,
        is_registered INTEGER DEFAULT 0
      );
    `);

    // Create Messages Table
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'sent'
      );
    `);

    // Add media columns if they don't exist (safe to run on existing DBs)
    try {
      await db.execAsync(`ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text';`);
    } catch { /* column already exists */ }
    try {
      await db.execAsync(`ALTER TABLE messages ADD COLUMN media_uri TEXT;`);
    } catch { /* column already exists */ }
    try {
      await db.execAsync(`ALTER TABLE contacts ADD COLUMN bio TEXT;`);
    } catch { /* column already exists */ }

    console.log('Local DB Initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize local DB:', error);
  }
};

// Functions to interact with the DB
export const saveContact = async (
  id: string,
  name: string,
  phone: string,
  isRegistered: boolean,
  bio?: string | null,
) => {
  if (!db) return;
  try {
    const statement = await db.prepareAsync(
      'INSERT OR REPLACE INTO contacts (id, name, phone, is_registered, bio) VALUES (?, ?, ?, ?, ?)'
    );
    await statement.executeAsync([id, name, phone, isRegistered ? 1 : 0, bio ?? null]);
    await statement.finalizeAsync();
  } catch (error) {
    console.error('Failed to save contact', error);
  }
};

export const deleteContact = async (id: string) => {
  if (!db) return;
  try {
    const statement = await db.prepareAsync('DELETE FROM contacts WHERE id = ?');
    await statement.executeAsync([id]);
    await statement.finalizeAsync();
  } catch (error) {
    console.error('Failed to delete contact', error);
  }
};

export const getContacts = async () => {
  if (!db) return [];
  try {
    const allRows = await db.getAllAsync('SELECT * FROM contacts');
    return allRows;
  } catch (error) {
    console.error('Failed to fetch contacts', error);
    return [];
  }
};

// Save a message (text or media) to the local database
export const saveMessage = async (
  id: string,
  conversationId: string,
  senderId: string,
  receiverId: string,
  content: string,
  type: string = 'text',
  mediaUri?: string,
) => {
  if (!db) return;
  try {
    const statement = await db.prepareAsync(
      'INSERT OR REPLACE INTO messages (id, conversation_id, sender_id, receiver_id, content, type, media_uri) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    await statement.executeAsync([id, conversationId, senderId, receiverId, content, type, mediaUri ?? null]);
    await statement.finalizeAsync();
  } catch (error) {
    console.error('Failed to save message', error);
  }
};

// Fetch all messages for a conversation, ordered by time
export const getMessagesByConversation = async (conversationId: string) => {
  if (!db) return [];
  try {
    const rows = await db.getAllAsync(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
      [conversationId]
    );
    return rows;
  } catch (error) {
    console.error('Failed to fetch messages', error);
    return [];
  }
};

// Fetch all conversations with their latest message
export const getConversations = async () => {
  if (!db) return [];
  try {
    const rows = await db.getAllAsync(`
      SELECT m.conversation_id, m.content AS last_message, m.timestamp AS last_time,
             m.type AS last_type, m.sender_id, m.receiver_id
      FROM messages m
      INNER JOIN (
        SELECT conversation_id, MAX(timestamp) AS max_ts
        FROM messages GROUP BY conversation_id
      ) latest ON m.conversation_id = latest.conversation_id
                AND m.timestamp = latest.max_ts
      ORDER BY m.timestamp DESC
    `);
    return rows;
  } catch (error) {
    console.error('Failed to fetch conversations', error);
    return [];
  }
};

// Delete all messages (clears chat history but preserves table schema and contacts)
export const deleteAllMessages = async () => {
  if (!db) return;
  try {
    await db.execAsync('DELETE FROM messages');
  } catch (error) {
    console.error('Failed to delete all messages', error);
  }
};

// Panic wipe — called from confirmDeleteFromLoginThunk after the server
// confirms the account row (and its FK-cascaded rows) are gone. Drops the
// local tables and closes the handle so a subsequent initDB() rebuilds a
// clean DB.
export const wipeLocalData = async () => {
  if (!db) return;
  try {
    await db.execAsync('DROP TABLE IF EXISTS contacts; DROP TABLE IF EXISTS messages;');
    await db.closeAsync();
  } catch (error) {
    console.error('Failed to wipe local DB', error);
  } finally {
    db = null;
  }
};
