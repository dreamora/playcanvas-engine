import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue } from "firebase/database";

const configStr = import.meta.env.VITE_FIREBASE_CONFIG;
let firebaseConfig = null;
if (configStr && configStr !== '{}') {
  try {
    firebaseConfig = JSON.parse(configStr);
  } catch (e) {
    console.error('Failed to parse VITE_FIREBASE_CONFIG. Ensure it is valid JSON (keys must be double-quoted):', e);
  }
}
const databaseUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let db: any = null;
if (firebaseConfig) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app, databaseUrl);
}

export { db, ref, onValue };
