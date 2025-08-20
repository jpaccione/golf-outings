// netlify/functions/get-weather.js
// This function acts as a secure proxy to fetch REAL weather data from an external weather API.

const fetch = require('node-fetch'); // Ensure 'node-fetch' is installed (npm install node-fetch)

exports.handler = async function(event, context) {
    // Extract query parameters sent from your frontend (location, date, time)
    const { location, date, time } = event.queryStringParameters;

    // Define CORS headers for all responses
    const headers = {
        "Content-Type": "application/json",
        // This header allows requests from any origin. For more security, you could
        // replace '*' with your specific Netlify site URL (e.g., 'https://parfect-strangers-golf-outings.netlify.app')
        "Access-Control-Allow-Origin": "*", 
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS", // Allow common methods
        "Access-Control-Allow-Headers": "Content-Type" // Allow Content-Type header
    };

    // Handle preflight OPTIONS requests for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No content needed for preflight
            headers: headers
        };
    }

    // IMPORTANT: Get your API key from WeatherAPI.com (or your chosen weather service)
    // and set it securely as a Netlify environment variable named WEATHER_API_KEY.
    // Go to Netlify Dashboard -> Site settings -> Build & deploy -> Environment.
    const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

    if (!WEATHER_API_KEY) {
        return {
            statusCode: 500,
            headers: headers, // Include headers even for error responses
            body: JSON.stringify({ error: 'Weather API Key not configured. Please set WEATHER_API_KEY in Netlify environment variables.' }),
        };
    }

    if (!location || !date || !time) {
        return {
            statusCode: 400,
            headers: headers, // Include headers even for error responses
            body: JSON.stringify({ error: 'Missing location, date, or time parameters for weather forecast.' }),
        };
    }

    try {
        // Format the date for WeatherAPI.com (YYYY-MM-DD)
        const dateObj = new Date(date);
        const formattedDate = dateObj.toISOString().split('T')[0]; // e.g., '2025-08-19'

        // Construct the URL for WeatherAPI.com's Future API
        // This API returns 14-day future forecast, suitable for your needs.
        // It takes 'q' (query/location) and 'dt' (date in YYYY-MM-DD).
        const weatherApiUrl = `http://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(location)}&dt=${formattedDate}&aqi=no&alerts=no`;

        console.log("Calling WeatherAPI.com URL:", weatherApiUrl);

        const response = await fetch(weatherApiUrl);
        const data = await response.json();

        if (!response.ok) {
            console.error("WeatherAPI.com error response:", data);
            // Handle specific WeatherAPI.com errors if necessary
            const errorMessage = data.error ? data.error.message : 'Unknown error from weather API';
            return {
                statusCode: response.status,
                headers: headers, // Include headers even for error responses
                body: JSON.stringify({ error: `Weather API Error: ${errorMessage}` }),
            };
        }

        // --- Extract and format data from WeatherAPI.com's response ---
        // WeatherAPI.com's forecast.json gives `forecast.forecastday` array.
        // We expect only one day for `dt` query.
        const forecastDay = data.forecast?.forecastday?.[0];

        if (!forecastDay) {
            return {
                statusCode: 404,
                headers: headers, // Include headers even for error responses
                body: JSON.stringify({ error: 'No forecast data found for the specified date.' }),
            };
        }

        const dayData = forecastDay.day;
        const hourData = forecastDay.hour; // Array of hourly forecasts

        // Find the closest hourly forecast to the teeTime for detailed conditions
        let closestHourForecast = null;
        let minDiff = Infinity;
        // Parse teeTime in HH:MM AM/PM format
        const [timePart, ampmPart] = time.split(' ');
        let [hours, minutes] = timePart.split(':').map(Number);

        // Adjust hours for PM and 12 AM/PM
        if (ampmPart && ampmPart.toLowerCase() === 'pm' && hours < 12) {
            hours += 12;
        } else if (ampmPart && ampmPart.toLowerCase() === 'am' && hours === 12) {
            hours = 0; // 12 AM (midnight)
        }

        const teeTimeInMinutes = hours * 60 + minutes;

        for (const hour of hourData) {
            const hourDate = new Date(hour.time);
            const currentHourInMinutes = hourDate.getHours() * 60 + hourDate.getMinutes();
            const diff = Math.abs(currentHourInMinutes - teeTimeInMinutes);
            
            // Prioritize hours on the requested day, if multiple days are returned (though `dt` should give one)
            // Or just find the closest hour based on time difference for the given forecast day
            if (diff < minDiff) {
                minDiff = diff;
                closestHourForecast = hour;
            }
        }

        const high_temp_day = dayData.maxtemp_f ? `${Math.round(dayData.maxtemp_f)}°F` : 'N/A';
        const conditions_tee_time = closestHourForecast?.condition?.text || 'N/A';
        const feels_like_temp = closestHourForecast?.feelslike_f ? `${Math.round(closestHourForecast.feelslike_f)}°F` : 'N/A';
        const precipitation_chance = dayData.daily_chance_of_rain !== undefined ? `${dayData.daily_chance_of_rain}%` : 'N/A';
        const wind_speed_direction = closestHourForecast?.wind_mph !== undefined ? `${Math.round(closestHourForecast.wind_mph)} mph from ${closestHourForecast.wind_dir}` : 'N/A';
        const uv_index = dayData.uv !== undefined ? `${Math.round(dayData.uv)}` : 'N/A';
        
        // This date should come from the forecast data to verify it's the correct day's forecast
        const forecast_updated_date = new Date(data.current.last_updated_epoch * 1000); // Convert epoch to date object
        const forecast_updated = forecast_updated_date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });


        // Return the structured weather data
        return {
            statusCode: 200,
            headers: headers, // Use the shared headers object
            body: JSON.stringify({
                high_temp_day,
                conditions_tee_time,
                feels_like_temp,
                precipitation_chance,
                wind_speed_direction,
                uv_index,
                forecast_updated,
                api_forecast_date: forecastDay.date // YYYY-MM-DD format directly from WeatherAPI to confirm date
            }),
        };

    } catch (error) {
        console.error('Netlify function error:', error);
        return {
            statusCode: 500,
            headers: headers, // Include headers even for error responses
            body: JSON.stringify({ error: 'Failed to fetch weather data: ' + error.message }),
        };
    }
};
