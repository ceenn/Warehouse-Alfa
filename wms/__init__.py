from datetime import timedelta
from flask import Flask, g, jsonify, render_template, request
from pymongo.errors import PyMongoError
from werkzeug.middleware.proxy_fix import ProxyFix
from config import Config
from .auth import SessionManager
from .core import AppError
from .database import Database
from .routes import api, auth_bp
from .seed import Seeder


def create_app():
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(Config)
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=Config.SESSION_HOURS)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

    Database.connect(Config.MONGO_URI, Config.MONGO_DB)
    if Config.SEED_DEFAULTS:
        Seeder.run()

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(api, url_prefix="/api")

    @app.before_request
    def load_user():
        g.user = SessionManager.current_user() if request.path.startswith("/api/") else None

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    @app.errorhandler(AppError)
    def handle_app_error(e):
        return jsonify({"error": e.message}), e.status

    @app.errorhandler(PyMongoError)
    def handle_db_error(e):
        app.logger.exception(e)
        return jsonify({"error": "Gangguan koneksi database. Coba lagi sebentar."}), 503

    @app.errorhandler(404)
    def handle_404(e):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Endpoint tidak ditemukan"}), 404
        return e

    @app.errorhandler(Exception)
    def handle_500(e):
        from werkzeug.exceptions import HTTPException
        if isinstance(e, HTTPException):
            return e
        app.logger.exception(e)
        return jsonify({"error": "Terjadi kesalahan pada server"}), 500

    return app
