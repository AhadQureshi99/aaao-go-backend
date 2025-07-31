// Importing required modules and controllers
import express from "express";
import {
  signupUser,
  verifyOTPUser,
  loginUser,
  forgotPassword,
  resetPassword,
  submitKYC,
  logout,
  resendOtp,
} from "../controllers/userController.js";
import multer from "multer";
import path from "path";
import authHandler from "../middlewares/authMIddleware.js"; // Correct casing

// Multer setup for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"), // Sets upload directory
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)), // Generates unique filename
});
const upload = multer({ storage }); // Initialize multer with storage configuration

// Route to handle user signup (no authentication required for initial signup)
const router = express.Router();
router.post("/signup", signupUser);

// Route to verify OTP for user account, requiring authentication
router.post("/verify-otp", verifyOTPUser);

// Route to handle user login (no authentication required for initial login)
router.post("/login", loginUser);

// Route to handle forgot password request, requiring authentication
router.post("/forgot-password", authHandler, forgotPassword);

// Route to reset user password, requiring authentication
router.post("/reset-password", authHandler, resetPassword);

// Route to submit KYC Level 1 with CNIC images and selfie, requiring authentication
router.post(
  "/submit-kyc",
  authHandler,
  upload.fields([
    { name: "frontImage" },
    { name: "backImage" },
    { name: "selfieImage" },
  ]),
  submitKYC
);

router.post("/logout", authHandler, logout);

// Route to resend OTP to user's email, requiring authentication
router.post("/resend-otp", resendOtp);

// Export router for use in main application
export default router;
