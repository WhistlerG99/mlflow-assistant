# mlflow-assistant
An AI assistant for MLFlow to help you diagnosis training runs and suggest ways to improve them.

# Setup

**For Chrome Browser**

1. Install the requirements
```bash
pip install -r requirements.txt
```

2. Start an MLFlow server 

3. Start the MLFlow Assistant with 
```bash
./start_mlflow_assistant.sh
```

4. Create a `.env` file by copying the template `.env.template` and copy your OpenAI and Langsmith (Optional) API keys, as well as your MLFlow server URL.

5. Open [chat-plugin.js](chat-plugin.js) and find the tags `<MLFLOW_URL>` and `<ASSISTANT_URL>`, and replace them with the urls for your MLFlow server and Assistant API

6. Install the [Tampermonkey](https://www.tampermonkey.net/) extension for Chrome

7. In the Tampermonkey Dashboard add a new script and copy paste the contents from [chat-plugin.js](chat-plugin.js) into it.

8. Enable Developer mode in Chrome by going to the puzzle icon in the top right of your browser window, click on the three vertical dots next to the Tempermonkey icon and select "Manage Extension". In the new window click on the slider next to "Developer mode" to activate it.

9. Open a Chrome tab, navigate to your MLFlow server page and you're done.
