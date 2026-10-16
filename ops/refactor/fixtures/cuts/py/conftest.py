import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))     # like the harness's conftest: tests import the modules beside them
