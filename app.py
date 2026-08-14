import os
import json
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="frontend")

DATA_DIR = "data"
PROJECTS_DIR = os.path.join(DATA_DIR, "projects")
MODULES_DIR = os.path.join(DATA_DIR, "modules")
LIBRARIES_DIR = os.path.join(DATA_DIR, "libraries")

# Ensure directories exist
for directory in [PROJECTS_DIR, MODULES_DIR, LIBRARIES_DIR]:
    os.makedirs(directory, exist_ok=True)


@app.route("/")
def index():
    return send_from_directory("frontend", "index.html")


@app.route("/<path:path>")
def static_proxy(path):
    # Try serving from frontend directory
    return send_from_directory("frontend", path)


# --- Projects API ---


@app.route("/api/projects", methods=["GET"])
def list_projects():
    try:
        files = [
            f[:-5]
            for f in os.listdir(PROJECTS_DIR)
            if os.path.isfile(os.path.join(PROJECTS_DIR, f)) and f.endswith(".json")
        ]
        return jsonify({"projects": files})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/projects/<name>", methods=["GET"])
def load_project(name):
    # Prevent directory traversal attacks
    safe_name = os.path.basename(name) + ".json"
    filepath = os.path.join(PROJECTS_DIR, safe_name)
    if not os.path.exists(filepath):
        return jsonify({"error": "Project not found"}), 404
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/projects/<name>", methods=["POST"])
def save_project(name):
    safe_name = os.path.basename(name) + ".json"
    filepath = os.path.join(PROJECTS_DIR, safe_name)
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON payload provided"}), 400
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
        return jsonify({"status": "success", "message": f"Project '{name}' saved successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/projects/<name>", methods=["DELETE"])
def delete_project(name):
    try:
        safe_name = os.path.basename(name) + ".json"
        filepath = os.path.join(PROJECTS_DIR, safe_name)
        if os.path.exists(filepath):
            os.remove(filepath)
            return jsonify({"status": "success", "message": f"Project '{name}' deleted successfully"})
        else:
            return jsonify({"error": "Project not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- Custom Modules API ---


@app.route("/api/modules", methods=["GET"])
def list_modules():
    try:
        modules = []
        for filename in os.listdir(MODULES_DIR):
            if filename.endswith(".json"):
                filepath = os.path.join(MODULES_DIR, filename)
                with open(filepath, "r", encoding="utf-8") as f:
                    try:
                        modules.append(json.load(f))
                    except Exception:
                        pass
        return jsonify({"modules": modules})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/modules", methods=["POST"])
def save_module():
    try:
        data = request.get_json()
        if not data or "id" not in data:
            return jsonify({"error": "Invalid custom module data"}), 400
        
        module_id = os.path.basename(data["id"])
        filepath = os.path.join(MODULES_DIR, f"{module_id}.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
        return jsonify({"status": "success", "message": f"Module '{module_id}' saved successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/modules/<module_id>", methods=["DELETE"])
def delete_module(module_id):
    try:
        safe_id = os.path.basename(module_id)
        filepath = os.path.join(MODULES_DIR, f"{safe_id}.json")
        if os.path.exists(filepath):
            os.remove(filepath)
            return jsonify({"status": "success", "message": f"Module '{module_id}' deleted successfully"})
        else:
            return jsonify({"error": "Module not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- Libraries API ---


@app.route("/api/libraries", methods=["GET"])
def list_libraries():
    try:
        libraries = []
        for filename in os.listdir(LIBRARIES_DIR):
            if filename.endswith(".json"):
                filepath = os.path.join(LIBRARIES_DIR, filename)
                with open(filepath, "r", encoding="utf-8") as f:
                    try:
                        libraries.append(json.load(f))
                    except Exception:
                        pass
        return jsonify({"libraries": libraries})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/libraries", methods=["POST"])
def save_library():
    try:
        data = request.get_json()
        if not data or "name" not in data:
            return jsonify({"error": "Invalid library data"}), 400
        
        lib_name = os.path.basename(data["name"])
        filepath = os.path.join(LIBRARIES_DIR, f"{lib_name}.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
        return jsonify({"status": "success", "message": f"Library '{lib_name}' saved successfully"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=True)
