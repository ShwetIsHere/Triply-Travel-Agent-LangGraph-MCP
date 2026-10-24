import os
import sys
import shutil
import asyncio
import certifi

from dotenv import load_dotenv
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_google_genai import ChatGoogleGenerativeAI

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEATHER_SERVER_SCRIPT = os.path.join(BASE_DIR, "custom_weather_mcp_server.py")
PYTHON_EXE = sys.executable if sys.executable else "python"

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
AVIATIONSTACK_API_KEY = os.getenv("AVIATIONSTACK_API_KEY")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
GEMINI_API_KEY = os.getenv("Gemini_API_KEY")


weather_llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash-lite",
    temperature=0,
    api_key=GEMINI_API_KEY
)


# Build servers dynamically so missing uvx does not crash everything
mcp_servers = {
    "tavily": {
        "transport": "streamable_http",
        "url": f"https://mcp.tavily.com/mcp/?tavilyApiKey={TAVILY_API_KEY}"
    },
    "weather": {
        "transport": "stdio",
        "command": PYTHON_EXE,
        "args": [
            WEATHER_SERVER_SCRIPT
        ],
        "env": {
            "OPENWEATHER_API_KEY": OPENWEATHER_API_KEY
        }
    }
}

if shutil.which("uvx") and AVIATIONSTACK_API_KEY:
    mcp_servers["aviationstack"] = {
        "transport": "stdio",
        "command": "uvx",
        "args": [
            "--with",
            "mcp<2",
            "aviationstack-mcp"
        ],
        "env": {
            "AVIATION_STACK_API_KEY": AVIATIONSTACK_API_KEY
        }
    }

client = MultiServerMCPClient(mcp_servers)


# to show all mcp tools
async def get_all_tools():
    tools = await client.get_tools()
    print("\n Available MCP tools: \n")

    for tool in tools:
        print(tool.name)

# list_airports
# list_airlines

##################################
# tavily and aviations tool
##################################

search_tool = None
aviation_tools = {}

async def initialize_mcp():

    global search_tool
    global aviation_tools

    if search_tool is not None:
        return

    tools = await client.get_tools()
    print("\n Available tools:")

    for tool in tools:
        print(tool.name)

    search_tool = next(
        (tool for tool in tools if tool.name == "tavily_search"),
        None
    )

    aviation_tools = {
        tool.name: tool
        for tool in tools
        if tool.name != "tavily_search"
    }


# for tavily search tool
async def tavily_mcp_search(query: str):
    await initialize_mcp()
    if search_tool is None:
        return "Search tool unavailable."
    results = await search_tool.ainvoke(
        {"query": query}
    )
    return results


# for aviationstack tools
async def aviation_mcp_call(tool_name: str, tool_args: dict = None):
    await initialize_mcp()

    tool = aviation_tools.get(tool_name)
    if not tool:
        return None

    try:
        result = await tool.ainvoke(
            tool_args or {}
        )
        return result
    except Exception as e:
        print(f"AviationStack tool {tool_name} error: {e}")
        return None



###################################
# Weather tools
###################################

weather_tool = None
forecast_tool = None

async def initialize_weather_tools():

    global weather_tool, forecast_tool
    if weather_tool is not None:
        return

    tools = await client.get_tools()

    weather_tool = next(
        t for t in tools
        if t.name == "get_current_weather"
    )

    forecast_tool = next(
        t for t in tools
        if t.name == "get_forecast"
    )

async def weather_mcp_search(city: str):

    await initialize_weather_tools()

    return await weather_tool.ainvoke(
        {
            "city": city
        }
    )

async def forecast_mcp_search(city: str):

    await initialize_weather_tools()

    return await forecast_tool.ainvoke(
        {
            "city": city
        }
    )

#######################################
# destination extraction tool
#######################################

def extract_destination(query: str):

    prompt = f"""
Extract only the destination city or country.

query: {query}

return only destination name.
"""

    response = weather_llm.invoke(prompt)

    return response.content.strip()