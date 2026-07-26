from ai.provider import AIProvider
from core.personality import SYSTEM_STYLE

class Assistant:

    def __init__(self):
        self.name = "JARVIS"
        self.ai = AIProvider()


    def process(self, message):

        message_lower = message.lower()


        if "hello" in message_lower or "hi" in message_lower:
            return "Good to see you, Jishnu. How can I assist you?"


        return self.ai.generate(message)