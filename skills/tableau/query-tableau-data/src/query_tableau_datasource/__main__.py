"""Thin CLI entry point so ``python -m query_tableau_datasource`` works.

This is a minimal wrapper — not a full CLI app.  For agent workflows,
import ``main.py`` directly and call ``run()`` or use ``Session``.

``.env`` loading is handled by ``pydantic-settings`` via ``SdkConfig``
(configured with ``env_file=".env"`` relative to CWD).
"""

from query_tableau_datasource.main import main

if __name__ == "__main__":
    main()
