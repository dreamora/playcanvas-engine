import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue } from "firebase/database";

const configStr = import.meta.env.VITE_FIREBASE_CONFIG;
const firebaseConfig = (configStr && configStr !== '{}') ? JSON.parse(configStr) : null;
const databaseUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let db: any = null;
if (firebaseConfig) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app, databaseUrl);
}

export { db, ref, onValue };
