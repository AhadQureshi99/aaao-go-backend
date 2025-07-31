// Importing required modules and models
import User from "../models/userModel.js";
import asyncHandler from "express-async-handler";
import nodemailer from "nodemailer";
import cloudinary from "cloudinary";
import jwt from "jsonwebtoken"; // Import JWT for token generation

// Validate environment variables for email configuration
if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
  console.error(
    "Missing email credentials: MAIL_USER or MAIL_PASS is undefined"
  );
  throw new Error("Server configuration error: Email credentials missing");
}

// Configure Nodemailer transporter for sending emails
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
});
transporter.verify((error) => {
  if (error) console.error("Nodemailer configuration error:", error.message);
  else console.log("Nodemailer is ready to send emails");
});

// Generate a 6-digit OTP for verification or password reset
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// Function to handle user signup and send OTP via email
const signupUser = asyncHandler(async (req, res) => {
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
    !sponsorBy
  ) {
    res.status(400);
    throw new Error("All fields are required");
  }
  const userExists = await User.findOne({ $or: [{ email }, { phoneNumber }] });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists with this email or phone number");
  }
  const otp = generateOTP();
  const user = await User.create({
    firstName,
    lastName,
    email,
    phoneNumber,
    password,
    sponsorBy,
    gender,
    otp,
  });
  await transporter.sendMail({
    from: `"Your App" <${process.env.MAIL_USER}>`,
    to: email,
    subject: "Your OTP for Account Verification",
    text: `Hello ${firstName} ${lastName},\nYour OTP for account verification is: ${otp}\nPlease enter this OTP to verify within 10 minutes.`,
    html: `<h2>Hello ${firstName} ${lastName},</h2><p>Your OTP is: <strong>${otp}</strong></p><p>Verify within 10 minutes.</p>`,
  });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
  res.status(201).json({
    message: "User registered. Verify OTP sent to your email.",
    userId: user._id,
    token,
  });
});

// Function to verify OTP and mark user as verified
const verifyOTPUser = asyncHandler(async (req, res) => {
  const { userId, otp } = req.body;
  const user = await User.findOne({ _id: userId });
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  if (user.isVerified) {
    res.status(400);
    throw new Error("User already verified");
  }
  if (user.otp !== otp) {
    res.status(400);
    throw new Error("Invalid OTP");
  }
  user.isVerified = true;
  user.otp = null;
  await user.save();
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
  res.status(200).json({ message: "OTP verified successfully", token });
});

// Function to handle user login
const loginUser = asyncHandler(async (req, res) => {
  const { email, phoneNumber, password } = req.body;
  if ((!email && !phoneNumber) || !password) {
    res.status(400);
    throw new Error("Email or phone number and password are required");
  }
  const user = await User.findOne({ $or: [{ email }, { phoneNumber }] });
  if (!user) {
    res.status(401);
    throw new Error("Invalid email or phone number");
  }
  if (!user.isVerified) {
    res.status(403);
    throw new Error("Please verify your email with OTP");
  }
  if (!(await user.comparePassword(password))) {
    res.status(401);
    throw new Error("Invalid password");
  }
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
  res.status(200).json({
    message: "Login successful",
    token,
    userId: user._id,
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
  });
});

// Function to handle forgot password request and send OTP
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400);
    throw new Error("Email is required");
  }
  const user = await User.findOne({ email });
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  const resetOtp = generateOTP();
  await User.findByIdAndUpdate(
    user._id,
    { resetOtp, resetOtpExpires: Date.now() + 10 * 60 * 1000 },
    { new: true, runValidators: true }
  );
  await transporter.sendMail({
    from: `"Your App" <${process.env.MAIL_USER}>`,
    to: email,
    subject: "Your OTP for Password Reset",
    text: `Hello ${user.firstName} ${user.lastName},\nYour OTP for password reset is: ${resetOtp}\nPlease use this OTP within 10 minutes.`,
    html: `<h2>Hello ${user.firstName} ${user.lastName},</h2><p>Your OTP is: <strong>${resetOtp}</strong></p><p>Use within 10 minutes.</p>`,
  });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
  res.status(200).json({ message: "Reset OTP sent to email", token });
});

// Function to reset user password using OTP
const resetPassword = asyncHandler(async (req, res) => {
  const { userId, resetOtp, password } = req.body;
  if (!userId || !resetOtp || !password) {
    res.status(400);
    throw new Error("User ID, reset OTP, and password are required");
  }
  const user = await User.findById(userId);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }
  if (
    user.resetOtp !== resetOtp ||
    !user.resetOtpExpires ||
    user.resetOtpExpires < Date.now()
  ) {
    res.status(400);
    throw new Error("Invalid or expired reset OTP");
  }
  user.password = password;
  user.resetOtp = null;
  user.resetOtpExpires = null;
  await user.save();
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
  res.status(200).json({ message: "Password reset successful", token });
});

// Function to handle KYC Level 1 submission
cloudinary.config({
  cloud_name: process.env.Cloud_Name,
  api_key: process.env.API_Key,
  api_secret: process.env.API_Secret,
});
const submitKYC = asyncHandler(async (req, res) => {
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
    res.status(400);
    throw new Error(
      "All fields including userId, full name, CNIC images, and selfie image are required"
    );
  }
  const [firstName, lastName] = fullName.split(" ").filter(Boolean);
  if (!firstName || !lastName) {
    res.status(400);
    throw new Error("Full name must contain both first and last names");
  }
  const user = await User.findById(userId);
  if (!user) {
    res.status(404);
    throw new Error("User not found. Please provide a valid user ID.");
  }
  const frontUpload = await cloudinary.uploader.upload(frontImage[0].path, {
    folder: "kyc/front",
  });
  const backUpload = await cloudinary.uploader.upload(backImage[0].path, {
    folder: "kyc/back",
  });
  const selfieUpload = await cloudinary.uploader.upload(selfieImage[0].path, {
    folder: "kyc/selfie",
  }); // Upload selfie
  user.firstName = firstName;
  user.lastName = lastName;
  user.country = country;
  user.gender = gender; // Set gender from KYC
  user.cnicImages = {
    front: frontUpload.secure_url,
    back: backUpload.secure_url,
  };
  user.selfieImage = selfieUpload.secure_url; // Store selfie image URL
  user.kycLevel = 1;
  user.isVerified = true;
  await user.save();
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
  res
    .status(200)
    .json({ message: "KYC Level 1 completed successfully", token });
});

// Handle user logout by clearing the token cookie
const logout = async (req, res) => {
  try {
    // Clear the token cookie
    res.clearCookie("token", { httpOnly: true, maxAge: 0 });
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message, token: req.cookies.token });
  }
};

export {
  signupUser,
  verifyOTPUser,
  loginUser,
  forgotPassword,
  resetPassword,
  submitKYC,
  logout,
};
