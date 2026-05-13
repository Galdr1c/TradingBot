import yaml
import os
from langgraph.prebuilt import create_react_agent

class SwarmOrchestrator:
    def __init__(self, llm):
        self.llm = llm
        self.presets_dir = os.path.join(os.path.dirname(__file__), "presets")

    def load_preset(self, preset_name):
        path = os.path.join(self.presets_dir, f"{preset_name}.yaml")
        with open(path, 'r') as f:
            return yaml.safe_load(f)

    def create_swarm(self, preset_name, tools):
        preset = self.load_preset(preset_name)
        # For MVP, we map the preset's agent tools to the global tool registry
        # A more advanced version would create separate agents per node
        return create_react_agent(self.llm, tools)
