#include <algorithm>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <tuple>
#include <vector>

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include "RVOSimulator.h"
#include "Vector3.h"

namespace py = pybind11;

using Triple = std::tuple<float, float, float>;
using Neighbor = std::tuple<Triple, Triple>;

RVO::Vector3 vector3(const Triple &value) {
  return RVO::Vector3(std::get<0>(value), std::get<1>(value), std::get<2>(value));
}

py::dict step(
    const Triple &position,
    const Triple &velocity,
    const Triple &preferred_velocity,
    const std::vector<Neighbor> &neighbors,
    float time_step,
    float neighbor_distance,
    std::size_t max_neighbors,
    float time_horizon,
    float radius,
    float max_speed) {
  if (time_step <= 0.0f || time_horizon <= 0.0f || radius < 0.0f || max_speed < 0.0f) {
    throw std::invalid_argument("invalid RVO2-3D simulator parameters");
  }

  RVO::RVOSimulator simulator(time_step, neighbor_distance, max_neighbors, time_horizon, radius, max_speed);
  const std::size_t primary = simulator.addAgent(vector3(position));
  simulator.setAgentVelocity(primary, vector3(velocity));
  simulator.setAgentPrefVelocity(primary, vector3(preferred_velocity));

  for (const Neighbor &neighbor : neighbors) {
    const std::size_t agent = simulator.addAgent(vector3(std::get<0>(neighbor)));
    const RVO::Vector3 neighbor_velocity = vector3(std::get<1>(neighbor));
    simulator.setAgentVelocity(agent, neighbor_velocity);
    simulator.setAgentPrefVelocity(agent, neighbor_velocity);
  }

  simulator.doStep();
  const RVO::Vector3 safe = simulator.getAgentVelocity(primary);
  py::dict result;
  result["velocity"] = py::make_tuple(safe.x(), safe.y(), safe.z());
  result["orca_plane_count"] = simulator.getAgentNumORCAPlanes(primary);
  result["neighbor_count"] = simulator.getAgentNumAgentNeighbors(primary);
  return result;
}

PYBIND11_MODULE(_rvo3d, module) {
  module.doc() = "Official snape/RVO2-3D binding for AirDnD";
  module.def("step", &step,
             py::arg("position"), py::arg("velocity"), py::arg("preferred_velocity"),
             py::arg("neighbors"), py::arg("time_step"), py::arg("neighbor_distance"),
             py::arg("max_neighbors"), py::arg("time_horizon"), py::arg("radius"),
             py::arg("max_speed"));
}
