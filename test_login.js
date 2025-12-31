const axios = require('axios');

async function testLogin() {
  try {
    console.log('Testing /login endpoint on port 3001...');
    const response = await axios.post('http://localhost:3001/login', {
      username: 'admin',
      password: 'password123'
    });
    
    console.log('Login Successful!');
    console.log('Token:', response.data.token);
    console.log('User:', response.data.user);
    
    // Test protected route
    console.log('\nTesting protected /users endpoint...');
    const usersResponse = await axios.get('http://localhost:3001/users', {
      headers: { Authorization: `Bearer ${response.data.token}` }
    });
    console.log('Fetch Users Successful! Count:', usersResponse.data.length);
    
  } catch (error) {
    console.error('Test Failed:', error.response ? error.response.data : error.message);
  }
}

testLogin();
