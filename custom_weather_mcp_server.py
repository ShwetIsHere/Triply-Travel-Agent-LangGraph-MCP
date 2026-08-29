from mcp.server.fastmcp import FastMCP
import requests
import os

from dotenv import load_dotenv

load_dotenv()

mcp = FastMCP("Weather MCP Server")

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
if not OPENWEATHER_API_KEY:
    raise ValueError("OPENWEATHER_API_KEY is missing. Please add it to your .env file.")

@mcp.tool()
def get_current_weather(city: str):

    response = requests.get(
        "https://api.openweathermap.org/data/2.5/weather",
        params = {
            "q": city,
            "appid": OPENWEATHER_API_KEY,
            "units": "metric"
        }
    )

    data = response.json()

    if response.status_code != 200:
        raise ValueError(f"Error fetching weather data: {data.get('message', 'Unknown error')}")

    return {
        "city": data["name"],
        "temperature_c": data["main"]["temp"],
        "feels_like_c": data["main"]["feels_like"],
        "humidity": data["main"]["humidity"],
        "condition": data["weather"][0]["description"],
        "wind_speed_mps": data["wind"]["speed"]
    }


@mcp.tool()
def get_forecast(city: str):

    url = "https://api.openweathermap.org/data/2.5/forecast"

    params = {
        "q": city,
        "appid": OPENWEATHER_API_KEY,
        "units": "metric"
    }

    response = requests.get(url, params=params)
    data = response.json()

    if response.status_code != 200:
        raise ValueError(f"Error fetching forecast data: {data.get('message', 'Unknown error')}")

    forecast = []

    for item in data["list"][:5]:
        forecast.append(
            {
                "datetime": item["dt_txt"],
                "temperature_c": item["main"]["temp"],
                "weather": item["weather"][0]["description"],
            }
        )

    return {
        "city": data.get("city", {}).get("name", city),
        "forecast": forecast
    }


if __name__ == "__main__":
    mcp.run()