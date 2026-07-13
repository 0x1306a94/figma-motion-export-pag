#include <cmath>
#include <iostream>
#include <memory>
#include <string>
#include "pag/file.h"
#include "pag/pag.h"

int main(int argumentCount, char** arguments) {
  if (argumentCount != 2) {
    std::cerr << "usage: verify <file.pag>\n";
    return 2;
  }

  auto file = pag::PAGFile::Load(std::string(arguments[1]));
  if (file == nullptr) {
    std::cerr << "PAGFile::Load failed\n";
    return 1;
  }
  if (file->width() != 320 || file->height() != 180 || file->numChildren() != 3) {
    std::cerr << "composition metadata mismatch\n";
    return 1;
  }
  if (std::abs(file->frameRate() - 30.0f) > 0.001f || file->duration() != 1000000) {
    std::cerr << "composition timing mismatch\n";
    return 1;
  }

  bool foundSolid = false;
  bool foundShape = false;
  bool foundImage = false;
  for (int index = 0; index < file->numChildren(); index++) {
    auto layer = file->getLayerAt(index);
    foundSolid = foundSolid ||
                 (layer != nullptr && layer->layerType() == pag::LayerType::Solid &&
                  layer->layerName() == "Background");
    foundShape = foundShape ||
                 (layer != nullptr && layer->layerType() == pag::LayerType::Shape &&
                  layer->layerName() == "Badge");
    foundImage = foundImage ||
                 (layer != nullptr && layer->layerType() == pag::LayerType::Image &&
                  layer->layerName() == "Picture");
  }
  if (!foundSolid || !foundShape || !foundImage || file->numImages() != 1) {
    std::cerr << "layer mismatch\n";
    return 1;
  }

  auto decoded = pag::File::Load(std::string(arguments[1]));
  auto rootLayer = decoded == nullptr ? nullptr : decoded->getRootLayer();
  auto composition = rootLayer == nullptr ? nullptr : dynamic_cast<pag::VectorComposition*>(rootLayer->composition);
  pag::Layer* animatedLayer = nullptr;
  if (composition != nullptr) {
    for (auto layer : composition->layers) {
      if (layer->name == "Badge") animatedLayer = layer;
    }
  }
  if (animatedLayer == nullptr || animatedLayer->transform == nullptr ||
      animatedLayer->transform->position == nullptr ||
      !animatedLayer->transform->position->animatable() ||
      animatedLayer->transform->position->getValueAt(15).x != 160) {
    std::cerr << "motion transform mismatch\n";
    return 1;
  }

  std::cout << "native PAG validation passed\n";
  return 0;
}
