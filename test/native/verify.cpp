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
  if (file->width() != 320 || file->height() != 180 || file->numChildren() != 5) {
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
  bool foundText = false;
  bool foundTrackMatte = false;
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
    foundText = foundText ||
                (layer != nullptr && layer->layerType() == pag::LayerType::Text &&
                 layer->layerName() == "Title");
    if (layer != nullptr && layer->layerName() == "Badge") {
      auto matte = layer->trackMatteLayer();
      foundTrackMatte = matte != nullptr && matte->layerName() == "Badge Matte";
    }
  }
  if (!foundSolid || !foundShape || !foundImage || !foundText || !foundTrackMatte ||
      file->numImages() != 1) {
    std::cerr << "layer mismatch\n";
    return 1;
  }

  auto decoded = pag::File::Load(std::string(arguments[1]));
  auto rootLayer = decoded == nullptr ? nullptr : decoded->getRootLayer();
  auto composition = rootLayer == nullptr ? nullptr : dynamic_cast<pag::VectorComposition*>(rootLayer->composition);
  pag::Layer* animatedLayer = nullptr;
  pag::Layer* maskedLayer = nullptr;
  pag::Layer* matteLayer = nullptr;
  if (composition != nullptr) {
    for (auto layer : composition->layers) {
      if (layer->name == "Badge") animatedLayer = layer;
      if (layer->name == "Picture") maskedLayer = layer;
      if (layer->name == "Badge Matte") matteLayer = layer;
    }
  }
  if (matteLayer == nullptr || matteLayer->isActive) {
    std::cerr << "track matte active state mismatch\n";
    return 1;
  }
  if (maskedLayer == nullptr || maskedLayer->masks.size() != 1 ||
      maskedLayer->masks[0]->maskMode != pag::MaskMode::Intersect ||
      !maskedLayer->masks[0]->inverted || maskedLayer->masks[0]->maskFeather == nullptr ||
      maskedLayer->masks[0]->maskFeather->getValueAt(0).x != 2 ||
      maskedLayer->masks[0]->maskOpacity->getValueAt(0) != 200 ||
      std::abs(maskedLayer->masks[0]->maskExpansion->getValueAt(0) - 1.5f) > 0.001f) {
    std::cerr << "mask mismatch\n";
    return 1;
  }
  if (animatedLayer == nullptr || animatedLayer->transform == nullptr ||
      animatedLayer->transform->position == nullptr ||
      !animatedLayer->transform->position->animatable() ||
      animatedLayer->transform->position->getValueAt(15).x != 160) {
    std::cerr << "motion transform mismatch\n";
    return 1;
  }
  if (animatedLayer->effects.size() != 1 ||
      animatedLayer->effects[0]->type() != pag::EffectType::FastBlur) {
    std::cerr << "layer blur mismatch\n";
    return 1;
  }
  auto blur = static_cast<pag::FastBlurEffect*>(animatedLayer->effects[0]);
  if (blur->blurriness == nullptr || !blur->blurriness->animatable() ||
      std::abs(blur->blurriness->getValueAt(0) - 21.2f) > 0.001f ||
      std::abs(blur->blurriness->getValueAt(18) - 60.0f) > 0.001f ||
      blur->repeatEdgePixels == nullptr || !blur->repeatEdgePixels->getValueAt(0)) {
    std::cerr << "layer blur property mismatch\n";
    return 1;
  }

  std::cout << "native PAG validation passed\n";
  return 0;
}
