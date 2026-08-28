import os
import asyncio
import certifi

from dotenv import load_dotenv
from langchain_mcp_adapters.client import MultiServerMCPClient

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

load_dotenv()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
AVIATIONSTACK_API_KEY = os.getenv("AVIATIONSTACK_API_KEY")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")

client = MultiServerMCPClient(
    {
        "tavily": {
            "transport": "streamable_http",
            "url": f"https://mcp.tavily.com/mcp/?tavilyApiKey={TAVILY_API_KEY}"
        },

        "aviationstack": {
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
    }
)


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

    if search_tool is not None and aviation_tools:
        return

    tools = await client.get_tools()
    print("\n Available tools:")

    for tool in tools:
        print(tool.name)

    search_tool = next(
        tool
        for tool in tools
        if tool.name == "tavily_search"
    )

    aviation_tools = {
        tool.name: tool
        for tool in tools
        if tool.name != "tavily_search"
    }


# for tavily search tool
async def tavily_mcp_search(query: str):
    await initialize_mcp()
    results = await search_tool.ainvoke(
        {"query": query}
    )
    return results


# for aviationstack tools
async def aviation_mcp_call(tool_name: str, tool_args: dict = None):
    await initialize_mcp()

    try:
        tool = aviation_tools[tool_name]
    except KeyError as error:
        available_tools = ", ".join(sorted(aviation_tools))
        raise ValueError(
            f"Unknown AviationStack tool '{tool_name}'. "
            f"Available tools: {available_tools}"
        ) from error

    result = await tool.ainvoke(
        tool_args or {}
    )

    return result