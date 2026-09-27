from pathlib import Path

from pybind11.setup_helpers import Pybind11Extension
from setuptools import find_packages, setup

RVO = Path("third_party") / "rvo2_3d" / "src"

setup(
    packages=find_packages("src"),
    package_dir={"": "src"},
    ext_modules=[
        Pybind11Extension(
            "airdnd._rvo3d",
            [
                "src/airdnd/_rvo3d.cpp",
                str(RVO / "Agent.cc"),
                str(RVO / "KdTree.cc"),
                str(RVO / "Plane.cc"),
                str(RVO / "RVOSimulator.cc"),
                str(RVO / "Vector3.cc"),
            ],
            include_dirs=[str(RVO)],
            cxx_std=17,
        )
    ],
)
