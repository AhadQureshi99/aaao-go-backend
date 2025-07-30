// Importing required module for MongoDB schema definition
import mongoose from "mongoose";

// Defining the vehicle schema with associated fields
const vehicleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true }, // Reference to the user owning the vehicle
  licenseImage: { type: String }, // URL for license image (Cloudinary)
  vehicleRegistrationCard: {
    front: { type: String }, // URL for front of registration card (Cloudinary)
    back: { type: String }, // URL for back of registration card (Cloudinary)
  },
  roadAuthorityCertificate: { type: String }, // URL for road authority certificate (Cloudinary)
  vehicleOwnerName: { type: String }, // Name of the vehicle owner
  companyName: { type: String }, // Company name (if applicable)
  vehiclePlateNumber: { type: String }, // Vehicle's plate number
  vehicleMakeModel: { type: String }, // Make and model of the vehicle
  chassisNumber: { type: String }, // Vehicle's chassis number
  vehicleColor: { type: String }, // Color of the vehicle
  registrationExpiryDate: { type: Date }, // Expiry date of vehicle registration
  insuranceCertificate: { type: String }, // URL for insurance certificate (Cloudinary)
  vehicleType: { type: String }, // Type of vehicle (e.g., car, truck)
  vehicleImages: [{ type: String }], // Array of URLs for additional vehicle images (Cloudinary)
  createdAt: { type: Date, default: Date.now }, // Automatically sets creation timestamp
});

export default mongoose.model("Vehicle", vehicleSchema);
