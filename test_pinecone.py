from pinecone import Pinecone
import os
from dotenv import load_dotenv

# Charger les variables du fichier .env.local
load_dotenv(".env.local")

# Initialiser Pinecone avec ta clé API
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))

# Sélectionner ton index déjà créé
index = pc.Index("nerion-face-index")

# Ajouter un vecteur de test
index.upsert([
    {
        "id": "user_test",
        "values": [0.1] * 512,
        "metadata": {"test": "true"}
    }
])

print("✅ Vecteur ajouté avec succès dans Pinecone")
