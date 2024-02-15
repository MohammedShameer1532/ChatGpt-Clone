const express = require("express");
const cors = require("cors");
const bodypParser = require("body-parser");
const { config } = require("dotenv");
const userModel = require("./assets/model");
const mongoose = require("mongoose");
const OpenAI = require("openai");
const bcrypt = require('bcryptjs');
const cookieParser = require("cookie-parser");
const jwt = require('jsonwebtoken');

// Load environment variables from .env file
config();
const configOpenAI = {
  apiKey: process.env.OPEN_AI_SECRET,
};
const PORT = process.env.PORT || 5000;
const openai = new OpenAI(configOpenAI);
const app = express();


app.use(bodypParser.json());
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(cookieParser());



main().catch(err => console.log(err));
async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URL,
    );
    console.log("db connected");
  } catch (err) {
    console.error(err);
  }
}

app.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    // // Check if the user already exists
    const userExist = await userModel.findOne({ email })

    if (userExist) {
      return res.status(400).json({ message: 'User already exists with the given emailId' });
    }
    // Hash the password
    const salt = await bcrypt.genSaltSync(10);
    const hash = await bcrypt.hashSync(password, salt);
    // Create a new user
    const newUser = await userModel.create({
      name,
      email,
      password: hash,

    })
    //creating jwt token and expires date jwt token
    const payload = {
      app: {
        id: newUser.id,
      }
    }
    const jsonData = jwt.sign(payload, process.env.JWT_Secret, {
      expiresIn: "2d"
    })
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_KEY, {
      expiresIn: '7d' // Longer-lived refresh token
    });
    return res.json({
      success: true,
      message: 'User registered successfully',
      data: { newUser, jsonData, refreshToken }
    });

  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
})
app.options('/signup', cors());

app.post('/login', async (req, res) => {
  try {
    const { email } = req.body;
    const loginUser = await userModel.findOne({ email })

    //checking the users email 
    if (loginUser) {
      const payload = {
        app: {
          id: loginUser.id,
          email: loginUser.email,
        }
      }
      //creating jwt token
      const jsonData = jwt.sign(payload, process.env.JWT_Secret)
      const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_KEY);
      // This line sends the response to the client
      res.cookie('token', jsonData, { httpOnly: true, secure: true });
      res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: true });

      return res.json({
        success: true,
        message: 'User login successfully',
        data: { loginUser, jsonData, refreshToken }
      });

    } else {
      return res.status(401).json({ error: 'Invalid email' });
    }

  } catch (error) {
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }

});


//logout api
app.post('/logout', (req, res) => {
  res.clearCookie('token'); // Clear the token cookie
  res.clearCookie('refreshToken'); // Clear the refresh token cookie
  res.json({ success: true, message: 'Logout successful' });
});


//authenticate the user
function authenticateToken(req, res, next) {
  const accessToken = req.cookies.token || req.headers.authorization?.split(" ")[1];
  const refreshToken = req.cookies.refreshToken;

  if (!accessToken && !refreshToken) {
    return res.status(404).json({ message: "Unauthorized: no token found" });
  }

  jwt.verify(accessToken, process.env.JWT_Secret, (err, user) => {
    if (err) {
      // Access token expired, try using the refresh token
      jwt.verify(refreshToken, process.env.JWT_Refresh_Secret, (refreshErr, refreshUser) => {
        if (refreshErr) {
          return res.status(403).json({ message: "Forbidden: Token Invalid" });
        }

        // If refresh token is valid, generate a new access token
        const newAccessToken = jwt.sign({ app: { id: refreshUser.app.id, email: refreshUser.app.email } }, process.env.JWT_Secret, {
          expiresIn: '1h'
        });

        res.cookie('token', newAccessToken, { httpOnly: true });
        req.user = refreshUser;
        req.userEmail = refreshUser.app.email;
        next();
      });
    } else {
      // Access token is valid
      req.user = user;
      req.userEmail = user.app.email;
      next();
    }
  });
}


app.get('/read', authenticateToken, async (req, res) => {
  const userId = req.user.app.id; // Retrieve user's ID from the token
  try {
    const searchData = await userModel.find({ userId });
    res.json(searchData); // Return the user's chat data to the authenticated user
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

app.options('/read', cors());


app.get('/loginuser', authenticateToken, async (req, res) => {
  const email = req.userEmail; // Retrieve user's email from req.user
  try {
    const searchData = await userModel.find({ email });

    res.json({
      email: email, // Include the user's email in the response
      data: searchData,
    });

  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});


app.delete('/deleteUser/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const deletedUser = await userModel.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});


app.post("/chat", authenticateToken, async (req, res) => {
  const { prompt } = req.body;
  const userId = req.user.app.id;
  const userEmail = req.userEmail;
  try {
    const completion = await openai.chat.completions.create({
      messages: [{ role: 'system', content: 'You are a helpful assistant.', },
      { role: "user", content: prompt }],
      model: 'gpt-3.5-turbo',
    });

    const responseFromOpenAI = completion.choices[0].message.content;

    // Save the prompt and response to MongoDB
    userModel.create({ prompt, response: responseFromOpenAI, userId, userEmail })
      .then(user => {
        console.log("Saved to MongoDB:", user);
        res.send(responseFromOpenAI);
      })
      .catch(err => {
        console.error('Error saving to MongoDB:', err);
        res.status(500).send("Internal Server Error");
      });
    console.log(completion.choices[0]);
  } catch (error) {
    console.error('Error fetching response from OpenAI::', error);
    res.status(500).send("Internal Server Error");
  }
});


app.listen(PORT, () =>
  console.log("server is running")
);


