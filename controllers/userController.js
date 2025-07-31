// Importing required modules and models
import User from "../models/userModel.js";
import TempUser from "../models/tempUserModel.js"; // Import TempUser model
import asyncHandler from "express-async-handler";
import nodemailer from "nodemailer";
import cloudinary from "cloudinary";
import jwt from "jsonwebtoken"; // Import JWT for token generation
import { v4 as uuidv4 } from "uuid"; // Import uuid for generating unique tempId

// Validate environment variables for email configuration
if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
  console.error(
    "Missing email credentials: MAIL_USER or MAIL_PASS is undefined"
  ); // Log error if email credentials are missing
  throw new Error("Server configuration error: Email credentials missing");
}

// Configure Nodemailer transporter for sending emails
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
}); // Set up email transporter
transporter.verify((error) => {
  if (error) console.error("Nodemailer configuration error:", error.message);
  // Log configuration errors
  else console.log("Nodemailer is ready to send emails"); // Confirm transporter is ready
});

// Generate a 6-digit OTP for verification or password reset
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString(); // Generate a random 6-digit OTP

// Function to handle user signup and send OTP via email
const signupUser = asyncHandler(async (req, res) => {
  // Extract registration data from request body
  const {
    firstName,
    lastName,
    email,
    phoneNumber,
    password,
    sponsorBy,
    gender,
  } = req.body;
  if (
    !firstName ||
    !lastName ||
    !email ||
    !phoneNumber ||
    !password ||
    !sponsorBy ||
    !gender
  ) {
    res.status(400); // Set status to 400 for bad request
    throw new Error("All fields are required"); // Throw error if any field is missing
  }
  // Check for existing TempUser and overwrite if found
  let tempUser = await TempUser.findOne({ email });
  const tempId = uuidv4(); // Generate unique tempId
  const otp = generateOTP(); // Generate OTP for verification
  if (tempUser) {
    tempUser.tempId = tempId;
    tempUser.otp = otp;
    await tempUser.save();
  } else {
    await TempUser.create({ email, phoneNumber, tempId, otp }); // Store temporary data
  }
  await transporter.sendMail({
    from: `"Your App" <${process.env.MAIL_USER}>`, // Sender email
    to: email, // Recipient email
    subject: "Your OTP for Account Verification", // Email subject
    text: `Hello ${firstName} ${lastName},\nYour OTP for account verification is: ${otp}\nPlease enter this OTP to verify within 10 minutes.`, // Plain text body
    html: `<h2>Hello ${firstName} ${lastName},</h2><p>Your OTP is: <strong>${otp}</strong></p><p>Verify within 10 minutes.</p>`, // HTML body
  });
  res.status(200).json({
    message: "OTP sent. Please verify to complete registration.",
    tempId, // Return tempId for verification
  }); // Respond without creating a full user
});

// Function to verify OTP and complete user registration
const verifyOTPUser = asyncHandler(async (req, res) => {
  // Extract tempId and OTP from request body
  const { tempId, otp, firstName, lastName, password, sponsorBy, gender } =
    req.body;
  if (
    !tempId ||
    !otp ||
    !firstName ||
    !lastName ||
    !password ||
    !sponsorBy ||
    !gender
  ) {
    res.status(400); // Set status to 400 for bad request
    throw new Error("All fields including tempId and OTP are required"); // Throw error if any field is missing
  }
  const tempUser = await TempUser.findOne({ tempId }); // Find temporary user by tempId
  if (!tempUser) {
    res.status(404); // Set status to 404 for not found
    throw new Error("Invalid or expired temporary session"); // Throw error if tempUser not found
  }
  if (Date.now() > tempUser.createdAt.getTime() + 10 * 60 * 1000) {
    await TempUser.findByIdAndDelete(tempUser._id); // Clean up expired tempUser
    res.status(400); // Set status to 400 for invalid request
    throw new Error("OTP has expired. Please restart registration."); // Throw error if OTP is expired
  }
  if (tempUser.otp !== otp) {
    res.status(400); // Set status to 400 for invalid request
    throw new Error("Invalid OTP"); // Throw error if OTP is incorrect
  }
  // Check for existing verified user before creating new one
  const userExists = await User.findOne({
    $or: [{ email: tempUser.email }, { phoneNumber: tempUser.phoneNumber }],
  });
  if (userExists) {
    res.status(400); // Set status to 400 for conflict
    throw new Error("User already exists with this email or phone number"); // Throw error if user exists
  }
  // Create full user after OTP verification
  const user = await User.create({
    firstName,
    lastName,
    email: tempUser.email,
    phoneNumber: tempUser.phoneNumber,
    password,
    sponsorBy,
    gender,
    isVerified: true,
  });
  // Update sponsor tree and levels if sponsor exists
  const sponsor = await User.findOne({ sponsorId: sponsorBy });
  if (sponsor) {
    sponsor.sponsorTree.push(user._id);
    await updateSponsorLevels(sponsor._id);
  }
  await TempUser.findByIdAndDelete(tempUser._id); // Clean up temporary user
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 });
  const sponsoredUsers = user.sponsorTree
    .map((s) => `${s.firstName} ${s.lastName}`)
    .join(", ");
  res.status(201).json({
    message: "Registration completed successfully",
    token,
    userId: user._id,
    sponsorId: user.sponsorId,
    level: user.level,
    sponsorTree: user.sponsorTree.map((s) => ({
      id: s._id,
      name: `${s.firstName} ${s.lastName}`,
    })),
    sponsoredUsers: sponsoredUsers || "No sponsored users",
    user: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      sponsorBy: user.sponsorBy,
      country: user.country,
      kycLevel: user.kycLevel,
      gender: user.gender,
    },
  });
});

// Function to handle user login
const loginUser = asyncHandler(async (req, res) => {
  // Extract login credentials from request body
  const { email, phoneNumber, password } = req.body;
  if ((!email && !phoneNumber) || !password) {
    res.status(400); // Set status to 400 for bad request
    throw new Error("Email or phone number and password are required"); // Throw error if credentials are missing
  }
  const user = await User.findOne({
    $or: [{ email }, { phoneNumber }],
  }).populate("sponsorTree", "firstName lastName"); // Find user by email or phone with populated sponsorTree
  if (!user) {
    res.status(401); // Set status to 401 for unauthorized
    throw new Error("Invalid email or phone number"); // Throw error if user not found
  }
  if (!user.isVerified) {
    res.status(403); // Set status to 403 for forbidden
    throw new Error("User not verified. Please complete registration."); // Throw error if user not verified
  }
  if (!(await user.comparePassword(password))) {
    res.status(401); // Set status to 401 for unauthorized
    throw new Error("Invalid password"); // Throw error if password doesn't match
  }
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  }); // Generate JWT token
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // Set cookie with 1-hour expiry
  const sponsoredUsers = user.sponsorTree
    .map((s) => `${s.firstName} ${s.lastName}`)
    .join(", ");
  res.status(200).json({
    message: "Login successful",
    token, // Include token in response
    userId: user._id,
    sponsorId: user.sponsorId,
    level: user.level,
    sponsorTree: user.sponsorTree.map((s) => ({
      id: s._id,
      name: `${s.firstName} ${s.lastName}`,
    })),
    sponsoredUsers: sponsoredUsers || "No sponsored users",
    user: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      sponsorBy: user.sponsorBy,
      country: user.country,
      kycLevel: user.kycLevel,
      gender: user.gender, // Include gender in response
    },
  }); // Respond with user details, token, sponsor info, and sponsored users
});

// Function to handle forgot password request and send OTP
const forgotPassword = asyncHandler(async (req, res) => {
  // Extract email from request body
  const { email } = req.body;
  if (!email) {
    res.status(400); // Set status to 400 for bad request
    throw new Error("Email is required"); // Throw error if email is missing
  }
  const user = await User.findOne({ email }); // Find user by email
  if (!user) {
    res.status(404); // Set status to 404 for not found
    throw new Error("User not found"); // Throw error if user doesn't exist
  }
  const resetOtp = generateOTP(); // Generate OTP for password reset
  await User.findByIdAndUpdate(
    user._id,
    { resetOtp, resetOtpExpires: Date.now() + 10 * 60 * 1000 }, // Set OTP and 10-minute expiry
    { new: true, runValidators: true }
  );
  await transporter.sendMail({
    from: `"Your App" <${process.env.MAIL_USER}>`, // Sender email
    to: email, // Recipient email
    subject: "Your OTP for Password Reset", // Email subject
    text: `Hello ${user.firstName} ${user.lastName},\nYour OTP for password reset is: ${resetOtp}\nPlease use this OTP within 10 minutes.`, // Plain text body
    html: `<h2>Hello ${user.firstName} ${user.lastName},</h2><p>Your OTP is: <strong>${resetOtp}</strong></p><p>Use within 10 minutes.</p>`, // HTML body
  });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  }); // Generate JWT token
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // Set cookie with 1-hour expiry
  res.status(200).json({ message: "Reset OTP sent to email", token }); // Respond with token
});

// Function to reset user password using OTP
const resetPassword = asyncHandler(async (req, res) => {
  // Extract data from request body
  const { userId, resetOtp, password } = req.body;
  if (!userId || !resetOtp || !password) {
    res.status(400); // Set status to 400 for bad request
    throw new Error("User ID, reset OTP, and password are required"); // Throw error if any field is missing
  }
  const user = await User.findById(userId); // Find user by ID
  if (!user) {
    res.status(404); // Set status to 404 for not found
    throw new Error("User not found"); // Throw error if user doesn't exist
  }
  if (
    user.resetOtp !== resetOtp ||
    !user.resetOtpExpires ||
    user.resetOtpExpires < Date.now()
  ) {
    res.status(400); // Set status to 400 for invalid request
    throw new Error("Invalid or expired reset OTP"); // Throw error if OTP is invalid or expired
  }
  user.password = password; // Update password
  user.resetOtp = null; // Clear reset OTP
  user.resetOtpExpires = null; // Clear expiry
  await user.save(); // Save updated user document
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  }); // Generate JWT token
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // Set cookie with 1-hour expiry
  res.status(200).json({ message: "Password reset successful", token }); // Respond with token
});

// Function to handle KYC Level 1 submission
cloudinary.config({
  cloud_name: process.env.Cloud_Name,
  api_key: process.env.API_Key,
  api_secret: process.env.API_Secret,
}); // Configure Cloudinary
const submitKYC = asyncHandler(async (req, res) => {
  // Extract KYC data from request body
  const { userId, fullName, country, gender } = req.body;
  const frontImage = req.files?.frontImage;
  const backImage = req.files?.backImage;
  const selfieImage = req.files?.selfieImage; // New field for live selfie
  if (
    !userId ||
    !fullName ||
    !country ||
    !frontImage ||
    !backImage ||
    !selfieImage
  ) {
    res.status(400); // Set status to 400 for bad request
    throw new Error(
      "All fields including userId, full name, CNIC images, and selfie image are required"
    ); // Throw error if any field is missing
  }
  const [firstName, lastName] = fullName.split(" ").filter(Boolean); // Split full name
  if (!firstName || !lastName) {
    res.status(400); // Set status to 400 for bad request
    throw new Error("Full name must contain both first and last names"); // Throw error if name is invalid
  }
  const user = await User.findById(userId); // Find user by ID
  if (!user) {
    res.status(404); // Set status to 404 for not found
    throw new Error("User not found. Please provide a valid user ID."); // Throw error if user not found
  }
  const frontUpload = await cloudinary.uploader.upload(frontImage[0].path, {
    folder: "kyc/front",
  }); // Upload front CNIC image
  const backUpload = await cloudinary.uploader.upload(backImage[0].path, {
    folder: "kyc/back",
  }); // Upload back CNIC image
  const selfieUpload = await cloudinary.uploader.upload(selfieImage[0].path, {
    folder: "kyc/selfie",
  }); // Upload selfie image
  user.firstName = firstName; // Update first name
  user.lastName = lastName; // Update last name
  user.country = country; // Update country
  user.gender = gender; // Update gender
  user.cnicImages = {
    front: frontUpload.secure_url, // Store front CNIC URL
    back: backUpload.secure_url, // Store back CNIC URL
  };
  user.selfieImage = selfieUpload.secure_url; // Store selfie URL
  user.kycLevel = 1; // Set KYC level to 1
  await user.save(); // Save updated user document
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  }); // Generate JWT token
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // Set cookie with 1-hour expiry
  res
    .status(200)
    .json({ message: "KYC Level 1 completed successfully", token }); // Respond with token
});

// Handle user logout by clearing the token cookie
const logout = async (req, res) => {
  try {
    // Clear the token cookie
    res.clearCookie("token", { httpOnly: true, maxAge: 0 });
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message, token: req.cookies.token }); // Respond with error
  }
};

// Function to resend OTP to user's email
const resendOtp = asyncHandler(async (req, res) => {
  // Extract tempId from request body
  const { tempId } = req.body;
  if (!tempId) {
    res.status(400); // Set status to 400 for bad request
    throw new Error("tempId is required"); // Throw error if tempId is missing
  }
  const tempUser = await TempUser.findOne({ tempId }); // Find temporary user by tempId
  if (!tempUser) {
    res.status(404); // Set status to 404 for not found
    throw new Error("Invalid or expired temporary session"); // Throw error if tempUser not found
  }
  const newOtp = generateOTP(); // Generate new OTP
  tempUser.otp = newOtp; // Update OTP in tempUser document
  await tempUser.save(); // Save updated tempUser document
  await transporter.sendMail({
    from: `"Your App" <${process.env.MAIL_USER}>`, // Sender email
    to: tempUser.email, // Recipient email
    subject: "Your New OTP for Account Verification", // Email subject
    text: `Hello ${firstName} ${lastName},\nYour new OTP for account verification is: ${newOtp}\nPlease enter this OTP to verify within 10 minutes.`, // Plain text body
    html: `<h2>Hello ${firstName} ${lastName},</h2><p>Your new OTP is: <strong>${newOtp}</strong></p><p>Verify within 10 minutes.</p>`, // HTML body
  });
  res.status(200).json({ message: "New OTP sent successfully", tempId }); // Respond with tempId
});

// Helper function to update sponsor levels recursively
async function updateSponsorLevels(userId) {
  const user = await User.findById(userId); // Find user by ID
  if (!user) return;

  // Count direct referrals (level 1)
  const directReferrals = user.sponsorTree.length;
  if (directReferrals >= 3 && user.level < 1) {
    user.level = 1;
  }

  // Check deeper levels
  const allReferrals = await User.find({ sponsorBy: user.sponsorId });
  let totalLevel2Referrals = 0;
  for (const referral of allReferrals) {
    const subReferrals = await User.find({ sponsorBy: referral.sponsorId });
    if (subReferrals.length >= 3 && referral.level < 2) {
      referral.level = 2;
      await referral.save();
      totalLevel2Referrals += 1;
    }
  }
  if (totalLevel2Referrals >= 3 && user.level < 2) {
    user.level = 2;
  }

  const level3Referrals = await User.find({
    level: 2,
    sponsorBy: user.sponsorId,
  });
  let totalLevel3Referrals = 0;
  for (const level2Referral of level3Referrals) {
    const subSubReferrals = await User.find({
      sponsorBy: level2Referral.sponsorId,
      level: 2,
    });
    if (subSubReferrals.length >= 3 && level2Referral.level < 3) {
      level2Referral.level = 3;
      await level2Referral.save();
      totalLevel3Referrals += 1;
    }
  }
  if (totalLevel3Referrals >= 3 && user.level < 3) {
    user.level = 3;
  }

  const level4Referrals = await User.find({
    level: 3,
    sponsorBy: user.sponsorId,
  });
  let totalLevel4Referrals = 0;
  for (const level3Referral of level4Referrals) {
    const subSubSubReferrals = await User.find({
      sponsorBy: level3Referral.sponsorId,
      level: 3,
    });
    if (subSubSubReferrals.length >= 3 && level3Referral.level < 4) {
      level3Referral.level = 4;
      await level3Referral.save();
      totalLevel4Referrals += 1;
    }
  }
  if (totalLevel4Referrals >= 3 && user.level < 4) {
    user.level = 4;
  }

  // Cap level at 4
  if (user.level > 4) user.level = 4;
  await user.save();

  // Recursively update sponsors
  if (user.sponsorBy !== "root") {
    const parentSponsor = await User.findOne({ sponsorId: user.sponsorBy });
    if (parentSponsor) {
      await updateSponsorLevels(parentSponsor._id);
    }
  }
}

// Export all controller functions
export {
  signupUser,
  verifyOTPUser,
  loginUser,
  forgotPassword,
  resetPassword,
  submitKYC,
  logout,
  resendOtp,
};
