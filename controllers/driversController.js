// Importing required modules and models
import Vehicle from "../models/vehicleModel.js";
import User from "../models/userModel.js";
import cloudinary from "cloudinary";

// Configuring Cloudinary for image uploads
cloudinary.config({
  cloud_name: process.env.Cloud_Name,
  api_key: process.env.API_Key,
  api_secret: process.env.API_Secret,
});

// Middleware to check if KYC Level 1 is completed
const kycLevel1Check = async (req, res, next) => {
  const user = await User.findById(req.user._id); // Assumes req.user is set by authMiddleware
  if (!user || user.kycLevel < 1) {
    return res
      .status(403)
      .json({
        message: "KYC Level 1 must be completed before proceeding to Level 2",
        token: req.cookies.token,
      });
  }
  next();
};

// Function to upload driver's license for KYC Level 2
const uploadLicense = async (req, res) => {
  const { userId } = req.body;
  const licenseImage = req.files?.licenseImage
    ? req.files.licenseImage[0]
    : null;

  // Validate user and KYC Level 1
  const user = await User.findById(userId);
  if (!user) {
    return res
      .status(404)
      .json({ message: "User not found", token: req.cookies.token });
  }
  if (user.kycLevel < 1) {
    return res
      .status(403)
      .json({
        message: "Complete KYC Level 1 first",
        token: req.cookies.token,
      });
  }

  try {
    // Upload license image to Cloudinary
    const uploadResult = licenseImage
      ? await cloudinary.uploader.upload(licenseImage.path, {
          folder: "kyc/license",
        })
      : null;
    if (!uploadResult) {
      return res
        .status(400)
        .json({
          message: "License image is required for KYC Level 2",
          token: req.cookies.token,
        });
    }

    // Update user's KYC Level to 2 and store license image
    user.kycLevel = 2;
    user.licenseImage = uploadResult.secure_url; // Store license image URL in user model
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
    res.status(200).json({
      message: "KYC Level 2 (License) uploaded successfully",
      hasVehicle: "Please select: Do you have a vehicle? (Yes/No)",
      token,
    });
  } catch (error) {
    res.status(500).json({ message: error.message, token: req.cookies.token });
  }
};

// Function to handle vehicle ownership decision
const handleVehicleDecision = async (req, res) => {
  const { userId, hasVehicle } = req.body;

  const user = await User.findById(userId);
  if (!user || user.kycLevel < 2) {
    return res
      .status(403)
      .json({
        message: "Complete KYC Level 2 first",
        token: req.cookies.token,
      });
  }

  if (hasVehicle === "no") {
    // Update role to driver without vehicle
    user.role = "driver";
    await user.save();
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
    res.status(200).json({
      message:
        "Role updated to driver. You can switch back to customer and book rides.",
      role: user.role,
      token,
    });
  } else if (hasVehicle === "yes") {
    // Proceed to vehicle registration
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
    res.status(200).json({
      message: "Please register your vehicle (all fields are optional)",
      nextStep: "vehicleRegistration",
      token,
    });
  } else {
    res
      .status(400)
      .json({
        message: "Please select Yes or No for vehicle ownership",
        token: req.cookies.token,
      });
  }
};

// Function to register vehicle (all fields optional)
const registerVehicle = async (req, res) => {
  const {
    userId,
    licenseImage,
    vehicleRegistrationCard,
    roadAuthorityCertificate,
    vehicleOwnerName,
    companyName,
    vehiclePlateNumber,
    vehicleMakeModel,
    chassisNumber,
    vehicleColor,
    registrationExpiryDate,
    insuranceCertificate,
    vehicleType,
    vehicleImages,
  } = req.body;

  const user = await User.findById(userId);
  if (!user || user.kycLevel < 2) {
    return res
      .status(403)
      .json({
        message: "Complete KYC Level 2 first",
        token: req.cookies.token,
      });
  }

  try {
    // Handle file uploads if provided
    const uploadToCloudinary = async (file) => {
      if (file) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: "vehicles",
        });
        return result.secure_url;
      }
      return null;
    };

    const uploadedLicenseImage = req.files?.licenseImage
      ? await uploadToCloudinary(req.files.licenseImage[0])
      : licenseImage;
    const vehicleRegistrationCardFront = req.files?.vehicleRegistrationCardFront
      ? await uploadToCloudinary(req.files.vehicleRegistrationCardFront[0])
      : vehicleRegistrationCard?.front;
    const vehicleRegistrationCardBack = req.files?.vehicleRegistrationCardBack
      ? await uploadToCloudinary(req.files.vehicleRegistrationCardBack[0])
      : vehicleRegistrationCard?.back;
    const roadAuthorityCertificateUrl = req.files?.roadAuthorityCertificate
      ? await uploadToCloudinary(req.files.roadAuthorityCertificate[0])
      : roadAuthorityCertificate;
    const insuranceCertificateUrl = req.files?.insuranceCertificate
      ? await uploadToCloudinary(req.files.insuranceCertificate[0])
      : insuranceCertificate;
    const vehicleImagesUrls = req.files?.vehicleImages
      ? await Promise.all(req.files.vehicleImages.map(uploadToCloudinary))
      : vehicleImages;

    // Create new vehicle entry (all fields optional)
    const vehicleData = {
      userId,
      licenseImage: uploadedLicenseImage,
      vehicleRegistrationCard: {
        front: vehicleRegistrationCardFront,
        back: vehicleRegistrationCardBack,
      },
      roadAuthorityCertificate: roadAuthorityCertificateUrl,
      vehicleOwnerName,
      companyName,
      vehiclePlateNumber,
      vehicleMakeModel,
      chassisNumber,
      vehicleColor,
      registrationExpiryDate: registrationExpiryDate
        ? new Date(registrationExpiryDate)
        : null,
      insuranceCertificate: insuranceCertificateUrl,
      vehicleType,
      vehicleImages: vehicleImagesUrls,
    };

    const vehicle = new Vehicle(vehicleData);
    await vehicle.save();

    // Update role to driver
    user.role = "driver";
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    res.cookie("token", token, { httpOnly: true, maxAge: 3600000 }); // 1 hour in ms
    res.status(201).json({
      message: "Vehicle registered successfully",
      vehicleId: vehicle._id,
      role: user.role,
      token,
    });
  } catch (error) {
    res.status(500).json({ message: error.message, token: req.cookies.token });
  }
};

export { uploadLicense, handleVehicleDecision, registerVehicle };
