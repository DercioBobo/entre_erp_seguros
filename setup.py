from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = f.read().strip().split("\n")

setup(
    name="entre_erp_seguros",
    version="0.0.1",
    description="Sistema de Gestão de Seguros para Moçambique",
    author="Entretech",
    author_email="info@entretech.co.mz",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=install_requires,
)
