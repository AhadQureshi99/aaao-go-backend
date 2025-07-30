// Importing required modules and controllers
import express from "express";
import {
  uploadLicense,
  handleVehicleDecision,
  registerVehicle,
} from "../controllers/driversController.js";
import multer from "multer";
import path from "path";
import authHandler from "../middlewares/authMIddleware.js"; // Import authentication middleware

// Multer setup for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"), // Sets upload directory
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)), // Generates unique filename
});
const upload = multer({ storage });

// Fields for file uploads with maximum counts
const uploadFields = [
  { name: "licenseImage", maxCount: 1 },
  { name: "vehicleRegistrationCardFront", maxCount: 1 },
  { name: "vehicleRegistrationCardBack", maxCount: 1 },
  { name: "roadAuthorityCertificate", maxCount: 1 },
  { name: "insuranceCertificate", maxCount: 1 },
  { name: "vehicleImages", maxCount: 4 },
];

// Route to upload driver's license for KYC Level 2, requiring authentication and KYC Level 1
const router = express.Router();
router.post(
  "/upload-license",
  authHandler,
  upload.single("licenseImage"),
  uploadLicense
);

// Route to handle vehicle ownership decision, requiring authentication and KYC Level 2
router.post("/vehicle-decision", authHandler, handleVehicleDecision);

// Route to register vehicle, requiring authentication and KYC Level 2
router.post(
  "/register-vehicle",
  authHandler,
  upload.fields(uploadFields),
  registerVehicle
);

export default router;
