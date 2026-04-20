import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, type Database } from "firebase/database";

const configStr = import.meta.env.VITE_FIREBASE_CONFIG;
const firebaseConfig = (configStr && configStr !== '{}') ? JSON.parse(configStr) : null;
const databaseUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let db: Database | null = null;
if (firebaseConfig) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app, databaseUrl);
}

const getDb = (): Database | null => db;

const getDbRef = (path: string) => {
  return db ? ref(db, path) : null;
};

export { db, getDb, getDbRef, ref, onValue };
