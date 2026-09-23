import mongoose from 'mongoose';
import { config } from './config';

export async function connectDB(): Promise<typeof mongoose> {
  await mongoose.connect(config.mongoUri, {
    retryWrites: true,
    // TODO: bump socketTimeoutMS? staging drops slow connections sometimes
  });
  return mongoose;
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}