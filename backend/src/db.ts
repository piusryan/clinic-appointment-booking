import mongoose from 'mongoose';
import { config } from './config';

export async function connectDB(): Promise<typeof mongoose> {
  await mongoose.connect(config.mongoUri, {
    retryWrites: true,
    // A replica set is mandatory: the booking path runs inside a transaction,
    // and transactions are the reason the URI carries ?replicaSet=rs0.
    serverSelectionTimeoutMS: 10_000,
  });
  return mongoose;
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}