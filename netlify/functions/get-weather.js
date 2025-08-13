// netlify/functions/get-weather.js
// This function acts as a secure proxy to fetch weather data from the Google Gemini API.

// We need 'node-fetch' to make HTTP requests in a Netlify Function environment.
// Make sure to add it as a dependency if you're bundling: npm install node-fetch
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    // Extract query parameters sent from your frontend (location, date, time)
    const { location, date, time } = event.queryStringParameters;

    // IMPORTANT: Your Google API key should be stored securely as an environment variable in Netlify.
    // Go to Netlify Dashboard -> Site settings -> Build & deploy -> Environment.
    // Add a new variable named WEATHER_API_KEY with your Google API key as its value.
    const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

    // Define the API URL for the Gemini model
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${WEATHER_API_KEY}`;

    // Construct the prompt for the Gemini API to request weather data
    const prompt = `Provide a detailed weather forecast for ${location} on ${date} at approximately ${time}. Include the high temperature for the day, the condition around the tee time (e.g., sunny, cloudy, partly cloudy, chance of rain), the "feels like" temperature, percentage chance of precipitation, wind speed and direction, and UV index. Present this information as a JSON object with the following structure:
        {
            "high_temp_day": "VALUE",
            "conditions_tee_time": "VALUE",
            "feels_like_temp": "VALUE",
            "precipitation_chance": "VALUE",
            "wind_speed_direction": "VALUE",
            "uv_index": "VALUE",
            "forecast_updated": "VALUE (e.g., August 14, 2025)"
        }`;

    // Prepare the payload for the Gemini API request
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json", // Request a JSON response
            responseSchema: { // Define the expected JSON schema
                type: "OBJECT",
                properties: {
                    "high_temp_day": { "type": "STRING" },
                    "conditions_tee_time": { "type": "STRING" },
                    "feels_like_temp": { "type": "STRING" },
                    "precipitation_chance": { "type": "STRING" },
                    "wind_speed_direction": { "type": "STRING" },
                    "uv_index": { "type": "STRING" },
                    "forecast_updated": { "type": "STRING" }
                }
            }
        }
    };

    // Implement exponential backoff for API calls
    const maxRetries = 3;
    let currentRetry = 0;
    let delay = 1000; // 1 second initial delay

    while (currentRetry < maxRetries) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // If the response is not OK, throw an error to trigger a retry
            if (!response.ok) {
                console.warn(`API call failed (attempt ${currentRetry + 1}). Status: ${response.status}`);
                if (response.status === 429) { // Too Many Requests
                    // Increase delay significantly for rate limit errors
                    delay = delay * 4;
                }
                throw new Error(`API call failed with status: ${response.status}`);
            }

            const result = await response.json();
            let weatherData = {};

            // Parse the response, handling potential markdown wrappers
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                let text = result.candidates[0].content.parts[0].text;
                if (text.startsWith('```json') && text.endsWith('```')) {
                    text = text.substring(7, text.length - 3).trim();
                } else if (text.startsWith('```') && text.endsWith('```')) {
                    text = text.substring(3, text.length - 3).trim();
                }
                weatherData = JSON.parse(text);
            } else {
                console.error("Invalid response structure from the Gemini API.");
                // Return a non-retryable error if the structure is fundamentally bad
                return {
                    statusCode: 500,
                    body: JSON.stringify({ error: "Invalid response from weather API." })
                };
            }

            // If successful, return the weather data
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(weatherData)
            };

        } catch (error) {
            currentRetry++;
            if (currentRetry < maxRetries) {
                console.warn(`Retrying in ${delay / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Double the delay for the next retry
            } else {
                console.error("Max retries reached. Failed to fetch weather data:", error);
                return {
                    statusCode: 500,
                    body: JSON.stringify({ error: "Failed to fetch weather data after multiple attempts." })
                };
            }
        }
    }
};
