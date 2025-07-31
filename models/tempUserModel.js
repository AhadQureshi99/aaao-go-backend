import mongoose from "mongoose";

const tempUserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  phoneNumber: { type: String, required: true, unique: true },
  tempId: { type: String, required: true, unique: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 600 }, // Expires after 10 minutes
});

const TempUser = mongoose.model("TempUser", tempUserSchema);
export default TempUser;